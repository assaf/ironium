const _                 = require('lodash');
const assert            = require('assert');
const { createDomain }  = require('domain');
const fivebeans         = require('fivebeans');
const ms                = require('ms');
const Q                 = require('q');


// How long to wait when reserving a job.
const RESERVE_TIMEOUT     = ms('5m');

// How long before we consider a request failed due to timeout.
// Should be longer than RESERVE_TIMEOUT.
const TIMEOUT_REQUEST     = RESERVE_TIMEOUT + ms('1s');

// Timeout for processing job before we consider it failed and release it back
// to the queue.
const PROCESSING_TIMEOUT  = ms('2m');

// Delay before a released job is available for pickup again (in seconds).
// This is our primary mechanism for dealing with back-pressure.  Ignored in
// test environment.
const RELEASE_DELAY       = ms('1m');

// Back-off in case of connection error, prevents continously failing to
// reserve a job.
const ERROR_BACKOFF       = ms('30s');


class Configuration {
  constructor(workers) {
    this._workers = workers;
  }

  get config() {
    let config = this._config;
    if (!config) {
      let source = this._workers._config && this._workers._config.queues;
      if (!source)
        source = (process.env.NODE_ENV == 'test') ? { prefix: 'test-' } : {};
      this._config = config = {
        hostname: source.hostname || 'localhost',
        port:     source.port     || 11300,
        prefix:   source.prefix
      };
      if (source.token) {
        config.authenticate = 'oauth ' + source.token + ' ' + source.projectID;
        config.webhookURL   = 'https://' + source.hostname + '/1/projects/' + source.projectID +
                              '/queues/{queueName}/messages/webhook?oauth=' + source.token;
      } else {
        config.authenticate = null;
        config.webhookURL   = 'https://<host>/1/projects/<project>/queues/{queueName}/messages/webhook?oauth=<token>';
      }
    }
    return config;
  }

  get hostname() {
    return this.config.hostname;
  }

  get port() {
    return this.config.port;
  }

  prefixedName(queueName) {
    return (this.config.prefix || '') + queueName;
  }

  // When using Iron.io, we send an authentication string based on the token.
  // Not applicable with standalone Beanstalkd.
  get authenticate() {
    return this.config.authenticate;
  }

  webhookURL(queueName) {
    return this.config.webhookURL.replace('{queueName}', queueName);
  }
}


// Abstracts a queue server, Beanstalkd or compatible, specifically Iron.io.
module.exports = class Server {

  constructor(workers) {
    this.notify   = workers;
    this.config   = new Configuration(workers);
    this._queues  = Object.create({});
  }

  // Returns a new queue.
  getQueue(name) {
    assert(name, "Missing queue name");
    let queue = this._queues[name];
    if (!queue) {
      queue = new Queue(name, this);
      this._queues[name] = queue;
    }
    return queue;
  }

  start() {
    this.notify.debug("Start all queues");
    for (let queue of this._allQueues)
      queue.start();
  }

  stop(callback) {
    this.notify.debug("Stop all queues");
    for (let queue of this._allQueues)
      queue.stop();
  }

  // This method only used when testing, will empty the contents of all queues.  Returns a promise.
  reset() {
    this.notify.debug("Clear all queues");
    let promises = this._allQueues.map((queue)=> queue.reset());
    return Q.all(promises);
  }

  // This method only used when testing, waits for all jobs to complete.
  once() {
    this.notify.debug("Process all queued jobs");
    let promises = this._allQueues.map((queue)=> queue.once());
    let deferred = Q.defer();

    Q.all(promises)
      .then((processed)=> {
        let anyProcessed = processed.indexOf(true) >= 0;
        if (anyProcessed)
          return this.once();
      })
      .then(function() {
        deferred.resolve();
      })
      .catch(function(error) {
        console.dir(error)
        deferred.reject(error)
      });

    return deferred.promise;
  }

  get _allQueues() {
    return _.values(this._queues);
  }

}


// Represents a Beanstalkd session.  Since GET requests block, you need
// separate sessions for each, and they are also setup differently.
//
// Underneath there is a Fivebeans client that gets connected and reconnected
// after failure.
//
// To use the underlying client, call the method `request`.
class Session {

  // Construct a new session.
  //
  // host         - Host name
  // port         - Port number
  // authenticate - Message used for authentication (iron.io only)
  // queueName    - Name of this queue
  // setup        - Setup function
  //
  // The setup function is called after the client has been connected and
  // authenticated, and before it can be used.  This method is called with two
  // arguments:
  //
  //
  // client   - Fivebeans client being setup
  // callback - Call with error or nothing
  constructor(name, server, setup) {
    this.name         = name;
    this.config       = server.config;
    this.notify       = server.notify;
    this.setup        = setup;
    this.pending      = [];
  }

  // Make a request to the server.
  //
  // command  - The command (e.g. put, get, destroy)
  // args     - Zero or more arguments, depends on command
  // callback - Called with error, or null and any result
  //
  // This is a simple wrapper around the Fivebeans client that will fail
  // requests that are never going to complete.  It fails requests whenever the
  // connection is reported to error/close, or after a fairly long timeout.
  request(command, ...args) {
    let deferred = Q.defer();

    // Called when command executed, connection closed/error, or timeout.
    // We reset the callback to make sure we only call it once.
    let oncomplete = (...args)=> {
      clearTimeout(timeout);
      this.pending.splice(this.pending.indexOf(oncomplete), 1);
      let error = args.shift();
      if (error)
        deferred.reject(error);
      else if (args.length > 1)
        deferred.resolve(args);
      else
        deferred.resolve(args[0]);
    }
    // The fail method will call this completion function.
    this.pending.push(deferred);
    // If command didn't complete within set timeout, fail the connection.
    let timeout = setTimeout(()=> {
      deferred.reject('TIMED_OUT');
    }, TIMEOUT_REQUEST);

    if (!this.deferred)
      this.connect();
    // Get Fivebeans to execute this command.
    this.deferred.promise
      .then(function(client) {
        client[command].call(client, ...args, oncomplete);
      })
      .catch((error)=> {
        this.fail(error);
        deferred.reject(error);
      });

    return deferred.promise;
  }

  _request(command, ...args) {
    let callback = args.pop();

    // Called when command executed, connection closed/error, or timeout.
    // We reset the callback to make sure we only call it once.
    let oncomplete = (...args)=> {
      if (callback) {
        clearTimeout(timeout);
        this.pending.splice(this.pending.indexOf(oncomplete), 1);
        callback(...args);
        callback = null;
      }
    }
    // The fail method will call this completion function.
    this.pending.push(oncomplete);
    // If command didn't complete within set timeout, fail the connection.
    let timeout = setTimeout(()=> {
      oncomplete(new Error('TIMED_OUT'));
    }, TIMEOUT_REQUEST);

    if (!this.deferred)
      this.connect();
    // Get Fivebeans to execute this command.
    this.deferred.promise
      .then(function(client) {
        client[command].call(client, ...args, oncomplete);
      })
      .catch(function(error) {
        this.fail(error);
        oncomplete(error);
      });
  }

  // Called when an error is detected with the underlying connection, forgets
  // about it since there's no way we can use it again.
  fail(error) {
    let message = error.toString();
    if (message != "Error: Connection closed")
      this.notify.error("Client error in queue %s: %s", this.name, message);
    // If we're in the process of setting up a connection, reject the promise.
    // Discard the promise, next/recursive call to use(fn) will re-connect.
    if (this.deferred) {
      this.deferred.reject(error);
      this.deferred = null;
    }
    // Fail all pending requests.
    let pending = this.pending.slice();
    this.pending.length = 0;
    setImmediate(()=> {
      let oncomplete;
      while (oncomplete = pending.shift())
        oncomplete(new Error('TIMED_OUT'));
    });
  }

  // Called to establish a new connection, returns a promise that would resolve
  // to a fully setup Fivebeans client.
  connect() {
    // This is the Fivebeans client is essentially a session.
    let client    = new fivebeans.client(this.config.hostname, this.config.port);
    let deferred  = Q.defer();

    // When working with iron.io, need to authenticate each connection before
    // it can be used.  This setup is followed by the setup.
    let authenticateAndSetup = ()=> {
      if (this.config.authenticate) {
        client.put(0, 0, 0, this.config.authenticate, function(error) {
          if (error) {
            deferred.reject(error);
            client.destroy();
          } else
            setupAndResolve();
        });
      } else
        setupAndResolve();
    }

    // Get/put clients have different setup requirements, this are handled by
    // an externally supplied method.  Once completed, the promise is resolved.
    let setupAndResolve = ()=> {
      this.setup(client, (error)=> {
        if (error) {
          deferred.reject(error);
          client.destroy();
        } else
          deferred.resolve(client);
      });
    }

    // First listen to the connection events, then attempt to connect.  This
    // will take us through the authenticate, setup and resolve path.
    client
      .on('connect', authenticateAndSetup)
      .on('error', (error)=> {
        this.fail(error);
        client.end();
      })
      .on('close', ()=> {
        this.fail(new Error("Connection closed"));
        client.end();
      });

    // Nothing happens until we start the connection.
    client.connect();
    // Make sure use/fail methods have access to the promise.
    this.deferred = deferred;
  }

}


// Abstraction for a queue.  Has two connections, one for pushing messages, one
// for processing them.
//
// name       - Queue name
// webhookURL - URL for receiving Webhook posts (Iron.io only)
// push       - Method for pushing job to the queue
// each       - Method for processing jobs from the queue
class Queue {

  constructor(name, server) {
    this.name           = name;
    this.notify         = server.notify;
    this.webhookURL     = server.config.webhookURL(name);
    this._server        = server;
    this._prefixedName  = server.config.prefixedName(name);

    this._processing  = false;
    this._handler     = null;
  }

  // Session for storing messages and other manipulations.
  get _put() {
    let session = this._putSession;
    if (!session) {
      // Setup: tell Beanstalkd which tube to use (persistent to session).
      session = new Session(this.name, this._server, (client, callback)=> {
        client.use(this._prefixedName, callback);
      });
      this._putSession = session;
    }
    return session;
  }

  // Session for processing messages, continously blocks so don't use elsewhere.
  get _reserve() {
    let session = this._reserveSession;
    if (!session) {
      // Setup: tell Beanstalkd which tube we're watching (and ignore default tube).
      session = new Session(this.name, this._server, (client, callback)=> {
        client.ignore('default', ()=> {
          client.watch(this._prefixedName, callback);
        });
      });
      this._reserveSession = session;
    }
    return session;
  }


  // Push job to queue.
  push(job, options, callback) {
    assert(job, "Missing job to queue");
    if (typeof(options) == 'function') {
      callback = options;
      options = null;
    }

    let payload = JSON.stringify(job);
    let delay   = (options && options.delay) || 0;

    let promise = this._put.request('put', 0, delay, PROCESSING_TIMEOUT / 1000, payload);
    if (callback) {
      // Don't pass jobID to callback, easy to use in test before hook, like
      // this:
      //   before((done)=> queue.put(MESSAGE, done));
      promise.then(()=> setImmediate(callback),
                   (error)=> callback(error));
    } else
      return promise;
  }


  // Process jobs from queue
  each(handler) {
    assert(typeof handler == 'function', "Called each without a valid handler");
    assert(!this._handler, "Already set handler for the queue " + this.name);
    this._handler = handler;
    if (this._processing)
      this._processContinously();
  }

  start() {
    if (!this._processing) {
      this._processing = true;
      if (this._handler)
        this._processContinously();
    }
  }

  stop() {
    this._processing = false;
  }


  // Called to process a single job.  Calls callback with error and flag that is
  // true if one (or more) jobs were processed.  Returns a promise which
  // resolves to true if any job was processed.
  once() {
    assert(!this._processing, "Cannot call once while continuously processing jobs");
    if (!this._handler)
      return Q.resolve(false);

    this.notify.debug("Waiting for jobs on queue %s", this.name);
    let outcome = Q.defer();
    let promise = this._reserve.request('reserve_with_timeout', 0);
    promise
      // If there's a job, we process it and resolve to true.
      .then(([jobID, payload])=> this._processJob(jobID, payload) )
      .then((x)=> outcome.resolve(true))
      // If there's no job, we ignore the error (DEADLINE_SOON/TIMED_OUT) and resolve to false.
      .catch((error)=> {
        if (error == 'DEADLINE_SOON' || error == 'TIMED_OUT' || (error && error.message == 'TIMED_OUT'))
          outcome.resolve(false);
        else
          outcome.reject(error);
      });
    return outcome.promise;
  }

  // Calles to process all jobs, until this._processing is set to false.
  _processContinously() {
    // Wait for the next job to become available, call processJob to have it processed, recurse.
    // Never wait if this is the test environment.
    let pickNextJob = ()=> {
      if (!this._processing)
        return;

      this._reserve._request('reserve_with_timeout', RESERVE_TIMEOUT / 1000, (error, jobID, payload)=> {
        if (error == 'DEADLINE_SOON' || error == 'TIMED_OUT' || (error && error.message == 'TIMED_OUT'))
          setImmediate(pickNextJob);
        else if (error) {
          this.notify.error(error);
          setTimeout(pickNextJob, ERROR_BACKOFF);
        } else {
          this._processJob(jobID, payload, (error)=> {
            if (error)
              this.notify.error(error);
            setImmediate(pickNextJob);
          });
        }
      });
    }

    this.notify.debug("Waiting for jobs on queue %s", this.name);
    pickNextJob();
  }

  // Called to process a job.  If successful, deletes job, otherwise returns job
  // to queue.
  _processJob(jobID, payload) {
    // Payload comes in the form of a buffer.
    payload = payload.toString();

    // Ideally we call the handler, handler calls the callback, all is well.
    // But the handler may throw an exception, or suffer some other
    // catastrophic outcome: we use a domain to handle that.  It may also
    // never halt, so we set a timer to force early completion.  And, of
    // course, handler may call callback multiple times, because.
    //
    // Now there are multiple exit options, so we need to normalize them all
    // into one of two outcomes, and that's what the promise is for.
    let outcomeDeferred = Q.defer();
    let domain          = createDomain();

    // This timer trigger if the job doesn't complete in time and rejects
    // the promise.
    let errorOnTimeout = setTimeout(function() {
      outcomeDeferred.reject(new Error("Timeout processing job"));
    }, PROCESSING_TIMEOUT);
    domain.add(errorOnTimeout);

    // Uncaught exception in the handler's domain will also reject the
    // promise.
    domain.on('error', function(error) {
      outcomeDeferred.reject(error);
    });

    outcomeDeferred.promise.then(()=> {
      // Promise resolved on successful completion; we destroy the job.
      this._reserve._request('destroy', jobID, (error)=> {
        if (error)
          this.notify.error(error.stack);
      });
      this.notify.info("Completed job %s from queue %s", jobID, this.name);
      // Move on to process next job.
      clearTimeout(errorOnTimeout);
    }, (error)=> {
      // Promise rejected (error or timeout); we release the job back to the
      // queue.  Since this may be a transient error condition (e.g. server
      // down), we let it sit in the queue for a while before it becomes
      // available again.
      let delay = (process.env.NODE_ENV == 'test' ? 0 : RELEASE_DELAY);
      this._reserve._request('release', jobID, 0, delay / 1000, (error)=> {
        if (error)
          this.notify.error(error.stack);
      });
      this.notify.error("Error processing job %s from queue %s: %s", jobID, this.name, error.stack);
      // Move on to process next job.
      clearTimeout(errorOnTimeout);
    });

    // Run the handler within the domain.  We use domain.intercept, so if
    // function throws exception, calls callback with error, or otherwise
    // has uncaught exception, it emits an error event.
    domain.run(()=> {

      this.notify.info("Picked up job %s from queue %s", jobID, this.name);
      this.notify.debug("Processing %s: %s", jobID, payload);
      // Typically we queue JSON objects, but the payload may be just a
      // string, e.g. some services send URL encoded name/value pairs, or MIME
      // messages.
      let job;
      try {
        job = JSON.parse(payload);
      } catch(ex) {
        job = payload;
      }
      this._handler(job, domain.intercept(function() {
        // Successful completion.
        outcomeDeferred.resolve();
      }));
    });

    return outcomeDeferred.promise;
  }

  // Delete all messages from the queue.  Returns a promise.
  reset() {
    let session = this._put;
    let outcome = Q.defer();
    session.request('peek_ready')
      // peek_ready checks if there's any job waiting in the queue, it either
      // gets a job ID, or the error `NOT_FOUND`, which we gently ignore.
      .then((jobID)=> session.request('destroy', jobID) )
      // If there's a job ID, we need to delete it, and promise recurse.
      .then(()=> this.reset() )
      // We're done recursing when error is `NOT_FOUND`.
      .catch((error)=> {
        if (error == 'NOT_FOUND')
          outcome.resolve();
        else
          outcome.reject(error);
      });
    return outcome.promise;
  }

}

