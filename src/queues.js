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


// Abstracts the queue server.
module.exports = class Server {

  constructor(workers) {
    this.notify   = workers;
    this.config   = new Configuration(workers);
    this._queues  = Object.create({});
  }

  // Returns the named queue, queue created on demand.
  getQueue(name) {
    assert(name, "Missing queue name");
    let queue = this._queues[name];
    if (!queue) {
      queue = new Queue(name, this);
      this._queues[name] = queue;
    }
    return queue;
  }

  // Starts processing jobs from all queues.
  start() {
    this.notify.debug("Start all queues");
    _.values(this._queues).forEach(function(queue) {
      queue.start();
    });
  }

  // Stops processing jobs from all queues.
  stop(callback) {
    this.notify.debug("Stop all queues");
    _.values(this._queues).forEach(function(queue) {
      queue.stop();
    });
  }

  // Use when testing to empty contents of all queues.  Returns a promise.
  reset() {
    this.notify.debug("Clear all queues");
    let queues    = _.values(this._queues);
    let promises  = queues.map((queue)=> queue.reset());
    return Q.all(promises);
  }

  // Use when testing to wait for all jobs to be processed.  Returns a promise. 
  once() {
    this.notify.debug("Process all queued jobs");
    let queues   = _.values(this._queues);
    let promises = queues.map((queue)=> queue.once());
    let outcome  = Q.defer();

    // Run one job from each queue, resolve to an array with true if queue had
    // processed a job.
    Q.all(promises)
      // If any queue has processed a job, run queues.once() again and wait
      // for it to resolve.
      .then((processed)=> {
        let anyProcessed = processed.indexOf(true) >= 0;
        if (anyProcessed)
          return this.once();
      })
      // When done runing all jobs, resolve/reject.
      .then(function() {
        outcome.resolve();
      }, function(error) {
        outcome.reject(error)
      });

    return outcome.promise;
  }

}


// Represents a Beanstalkd session.  Since GET requests block, need separate
// sessions for pushing and processing, and each is also setup differently.
//
// Underneath there is a Fivebeans client that gets connected and automatically
// reconnected after failure (plus some error handling missing from Fivebeans).
//
// To use the underlying client, call the method `request`.
class Session {

  // Construct a new session.
  //
  // name    - Queue name, used for error reporting
  // config  - Queue server configuration, used to establish connection
  // notify  - Logging and errors
  // setup   - The setup function, see below
  //
  // Beanstalkd requires setup to either use or watch a tube, depending on the
  // session.  The setup function is provided when creating the session, and is
  // called after the connection has been established (and for Iron.io,
  // authenticated).
  //
  // The setup function is called with two arguments:
  // client   - Fivebeans client being setup
  // callback - Call with error or nothing
  constructor(name, server, setup) {
    this.name   = name;
    this.config = server.config;
    this.notify = server.notify;
    this.setup  = setup;
  }

  // Make a request to the server, returns a promise.
  //
  // command  - The command (e.g. put, get, destroy)
  // args     - Zero or more arguments, depends on command
  //
  // This is a simple wrapper around the Fivebeans client with additional error
  // handling.  It returns a promise that resolves, depending on the arity of
  // the API response, to either single value or array.
  request(command, ...args) {
    let outcome = Q.defer();

    function makeRequest(client) {
      try {

        // Catch commands that don't complete in time.  If the connection
        // breaks for any reason, Fivebeans never calls the callback, the only
        // way we can handle this condition is with a timeout.
        let requestTimeout = setTimeout(()=> outcome.reject('TIMED_OUT'), TIMEOUT_REQUEST);

        client[command].call(client, ...args, function(error, ...results) {
          clearTimeout(requestTimeout);
          if (error)
            outcome.reject(error);
          else if (results.length > 1)
            outcome.resolve(results);
          else
            outcome.resolve(results[0]);
        });

      } catch (error) {
        // e.g. command doesn't exist so client[command] is undefined
        outcome.reject(error);
      }
    }

    // Wait for open connection, then execute the command.
    this.connect().then(makeRequest, (error)=> {
      this.promise = null; // will connect again next time
      outcome.reject(error);
    });
    return outcome.promise;
  }

  // Called to establish a new connection, returns a promise that would resolve
  // to Fivebeans client.
  connect() {
    // this.promise is set after first call to `connect`, and until we detect a
    // connection failure and terminate it.
    if (this.promise)
      return this.promise;

    // This is the Fivebeans client is essentially a session.
    let client    = new fivebeans.client(this.config.hostname, this.config.port);
    let outcome  = Q.defer();

    // When working with iron.io, need to authenticate each connection before
    // it can be used.  This is the first setup step, followed by the
    // session-specific setup.
    let authenticateAndSetup = ()=> {
      if (this.config.authenticate) {
        client.put(0, 0, 0, this.config.authenticate, function(error) {
          if (error) {
            outcome.reject(error);
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
          outcome.reject(error);
          client.destroy();
        } else
          outcome.resolve(client);
      });
    }

    // First listen to the connection events, then attempt to connect.  This
    // will take us through the authenticate, setup and resolve path.
    client
      .on('connect', authenticateAndSetup)
      .on('error', (error)=> {
        // Discard this connection
        this.promise = null; // will connect again next time
        outcome.reject(error);
        this.notify.error("Client error in queue %s: %s", this.name, error.toString());
        client.end();
      })
      .on('close', ()=> {
        // Discard this connection
        this.promise = null; // will connect again next time
        this.notify.error("Connection closed for %s", this.name);
        client.end();
      });

    // Nothing happens until we start the connection.
    client.connect();

    // Every call to `connect` should be able to access this promise.
    this.promise = outcome.promise;
    return this.promise;
  }

}


// Abstraction for a queue.  Has two sessions, one for pushing messages, one
// for processing them.
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

  // Session for storing messages and other manipulations, created lazily
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

  // Session for processing messages, created lazily.  This sessions is
  // blocked, so all other operations should happen on the _put session.
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
  push(job, callback) {
    assert(job, "Missing job to queue");

    let payload = JSON.stringify(job);
    let promise = this._put.request('put', 0, 0, PROCESSING_TIMEOUT / 1000, payload);
    if (callback) {
      // Don't pass jobID to callback, easy to use in test before hook, like
      // this:
      //   before((done)=> queue.put(MESSAGE, done));
      promise.then(()=> setImmediate(callback),
                   (error)=> callback(error));
    } else
      return promise;
  }

  // Process jobs from queue.
  each(handler) {
    assert(typeof handler == 'function', "Called each without a valid handler");
    assert(!this._handler, "Already set handler for the queue " + this.name);
    this._handler = handler;
    this._processContinously();
  }

  // Start processing jobs.
  start() {
    this._processing = true;
    this._processContinously();
  }

  // Stop processing jobs.
  stop() {
    this._processing = false;
  }

  // Called to process a single job.  Returns a promise which resolves to true
  // if any job was processed.
  once() {
    assert(!this._processing, "Cannot call once while continuously processing jobs");
    if (!this._handler)
      return Q.resolve(false);

    this.notify.debug("Waiting for jobs on queue %s", this.name);
    let outcome = Q.defer();
    this._reserve.request('reserve_with_timeout', 0)
      // If there's a job, we process it and resolve to true.
      .then(([jobID, payload])=> this._processJob(jobID, payload) )
      .then(()=> outcome.resolve(true))
      // If there's no job, we ignore the error (DEADLINE_SOON/TIMED_OUT) and resolve to false.
      .catch((error)=> {
        if (error == 'DEADLINE_SOON' || error == 'TIMED_OUT' || (error && error.message == 'TIMED_OUT'))
          outcome.resolve(false);
        else
          outcome.reject(error);
      });
    return outcome.promise;
  }

  // Called to process all jobs, until this._processing is set to false.
  _processContinously() {
    // Don't do anything without a handler, stop when processing is false.
    if (!(this._processing && this._handler))
      return;

    let repeat = (timeout)=> {
      if (this._processing) {
        if (timeout)
          setTimeout(this._processContinously.bind(this), timeout);
        else
          setImmediate(this._processContinously.bind(this));
      }
    }

    this.notify.debug("Waiting for jobs on queue %s", this.name);
    this._reserve.request('reserve_with_timeout', 30)
      // If there's a job, we process and recurse.
      .then(([jobID, payload])=> this._processJob(jobID, payload) )
      .then(repeat, (error)=> {
        // No job in queue, go back to wait for new job.
        if (error == 'DEADLINE_SOON' || error == 'TIMED_OUT' || (error && error.message == 'TIMED_OUT'))
          repeat();
        else {
          // Error, backoff for a bit.
          this.notify.error(error);
          repeat(ERROR_BACKOFF);
        }
      });
  }

  // Called to process a job.  If successful, deletes job, otherwise returns job
  // to queue.  Returns a promise.
  _processJob(jobID, payload) {
    // Payload comes in the form of a buffer.
    payload = payload.toString();

    // Ideally we call the handler, handler calls the callback, all is well.
    // But the handler may throw an exception, or suffer some other
    // catastrophic outcome: we use a domain to handle that.  It may also
    // never halt, so we set a timer to force early completion.  And, of
    // course, handler may call callback multiple times, because.
    let outcome = Q.defer();
    let domain  = createDomain();

    // Uncaught exception in the handler's domain will also reject the
    // promise.
    domain.on('error', function(error) {
      outcome.reject(error);
    });

    // This timer trigger if the job doesn't complete in time and rejects
    // the promise.
    let errorOnTimeout = setTimeout(function() {
      outcome.reject(new Error("Timeout processing job"));
    }, PROCESSING_TIMEOUT);
    domain.add(errorOnTimeout);

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
      if (this._handler.length == 1) {

        // Single argument, we pass a job and expect a promise, or treat the
        // outcome as successful.
        try {
          let promise = this._handler(job);
          if (promise && promise.then) {
            promise.then(()=> outcome.resolve(),
                         (error)=> outcome.reject(error));
          } else
            outcome.resolve();
        } catch (error) {
          outcome.reject(error);
        }

      } else {

        // Multiple arguments.
        this._handler(job, domain.intercept(function() {
          // Successful completion, error taken care of by on('error')
          outcome.resolve();
        }));

      }
    });

    outcome.promise
      // Successfully performed job, destroy it.
      .then(()=> this._reserve.request('destroy', jobID) )
      .then(()=> {
        this.notify.info("Completed job %s from queue %s", jobID, this.name);
        clearTimeout(errorOnTimeout);
      })
      .catch((error)=> {
        // Promise rejected (error or timeout); we release the job back to the
        // queue.  Since this may be a transient error condition (e.g. server
        // down), we let it sit in the queue for a while before it becomes
        // available again.
        let delay = (process.env.NODE_ENV == 'test' ? 0 : RELEASE_DELAY);
        this._reserve.request('release', jobID, 0, delay / 1000)
          .catch((error)=> this.notify.error(error.stack) );
        this.notify.error("Error processing job %s from queue %s: %s", jobID, this.name, error.stack);
        // Move on to process next job.
        clearTimeout(errorOnTimeout);
      });

    return outcome.promise;
  }

  // Delete all messages from the queue.  Returns a promise.
  reset() {
    // We're using the reserve session, so this will block indefinitely if
    // queues are started, and fail the test.
    let session = this._reserve;
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

