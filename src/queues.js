const _                 = require('lodash');
const assert            = require('assert');
const Async             = require('async');
const { createDomain }  = require('domain');
const fivebeans         = require('fivebeans');
const ms                = require('ms');
const Q                 = require('q');


// How long to wait when reserving a job (in seconds).
const RESERVE_TIMEOUT     = ms('5m');

// How long before we consider a request failed due to timeout (in seconds).
// Should be longer than RESERVE_TIMEOUT.
const TIMEOUT_REQUEST     = RESERVE_TIMEOUT + ms('1s');

// Timeout for processing job before we consider it failed and release it back
// to the queue (in seconds).
const PROCESSING_TIMEOUT  = ms('2m');

// Delay before a released job is available for pickup again (in seconds).
// This is our primary mechanism for dealing with back-pressure.  Ignored in
// test environment.
const RELEASE_DELAY       = ms('1m');



// Abstracts an Iron.io project / Beanstalkd configuration.
//
// Configured with:
// host       - Host name (defaults to localhost)
// port       - Port number (defaults to 11300)
// projectID  - Iron.io project ID
// token      - Iron.io authentication token
// prefix     - Queue name prefix (e.g. test-)
module.exports = class Queues {

  constructor(logger = console, { host = 'localhost', port = 11300, projectID, token, prefix }) {
    this._logger      = logger;
    // When using Iron.io, we send an authentication string based on the token.
    // Not applicable with standalone Beanstalkd.
    if (token)
      this._authenticate = 'oauth ' + token + ' ' + projectID;
    // These are used to connect the client.
    this._host        = host;
    this._port        = port;
    // Prefix used in certain environment, e.g. "test-"
    this._prefix      = prefix;
    // Base URL for all Webhooks, queues set their name via interoplation.
    this._webhookURL  = 'https://' + host + '/1/projects/' + projectID +
                        '/queues/{queueName}/messages/webhook?oauth=' + token;
    // Map (un-prefixed) queue name to queue.
    this._queues      = Object.create({});
  }

  // Returns a new queue.
  getQueue(name) {
    assert(name, "Missing queue name");
    let queue = this._queues[name];
    if (!queue) {
      queue = new Queue({
        name,
        prefixedName: this._prefix + name,
        host:         this._host,
        port:         this._port,
        authenticate: this._authenticate,
        webhookURL:   this._webhookURL.replace('{queueName}', name),
        logger:       this._logger
      });
      this._queues[name] = queue;
    }
    return queue;
  }

  start() {
    this._logger.debug("Start all queues");
    this._foreachQueue((queue)=> queue.start());
  }

  stop(callback) {
    this._logger.debug("Stop all queues");
    this._foreachQueue((queue)=> queue.stop());
  }

  // This method only used when testing, will empty the contents of all queues.
  reset(callback) {
    this._logger.debug("Clear all queues");
    this._foreachQueue((queue, done)=> queue.reset(done), callback);
  }

  // This method only used when testing, waits for all jobs to complete.
  once(callback) {
    this._logger.debug("Process all queued jobs");
    let queues = _.values(this._queues);
    function iterate() {
      Async.reduce(queues, false,
        function(processedAny, queue, done) {
          queue.once(function(error, processed) {
            done(error, processedAny || processed);
          });
        },
        function(error, processedAny) {
          if (processedAny)
            iterate();
          else
            callback(error);
        });
    }
    iterate();
  }

  _foreachQueue(fn, callback) {
    let queues = _.values(this._queues);
    if (arguments.length > 1)
      Async.forEach(queues, fn, callback);
    else
      queues.forEach(fn);
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
  constructor({ name, host, port, authenticate, logger }, setup) {
    this.name         = name;
    this.host         = host;
    this.port         = port;
    this.authenticate = authenticate;
    this.setup        = setup;
    this.pending      = [];
    this._logger      = logger;
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
    // Get Fivebeans to execute this command.
    this._withClient(function(client) {
      client[command].call(client, ...args, oncomplete);
    });
  }

  // Called when an error is detected with the underlying connection, forgets
  // about it since there's no way we can use it again.
  fail(error) {
    let message = error.toString();
    if (message != "Error: Connection closed")
      this._logger.error("Client error in queue %s: %s", this.name, message);
    // If we're in the process of setting up a connection, reject the promise.
    // Discard the promise, next/recursive call to use(fn) will re-connect.
    if (this._deferred) {
      this._deferred.reject(error);
      this._deferred = null;
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

  // Call this method when you need access to the Beanstalked server.  It will
  // initialize a Fivebeans client, setup the session, and pass it to the
  // function.
  _withClient(fn) {
    if (!this._deferred)
      this._connect();
    this._deferred.promise.then(fn, (error)=> {
      this.fail(error);
      this.use(fn);
    });
  }

  // Called to establish a new connection, returns a promise that would resolve
  // to a fully setup Fivebeans client.
  _connect() {
    // This is the Fivebeans client is essentially a session.
    let client    = new fivebeans.client(this.host, this.port);
    let deferred  = Q.defer();

    // When working with iron.io, need to authenticate each connection before
    // it can be used.  This setup is followed by the setup.
    let authenticateAndSetup = ()=> {
      if (this.authenticate) {
        client.put(0, 0, 0, this.authenticate, function(error) {
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
    this._deferred = deferred;
  }

}


// Abstraction for a queue.  Has two connections, one for pushing messages, one
// for processing them.
//
// name       - Queue name
// webhookURL - URL for receiving Webhook posts (Iron.io only)
// put        - Method for putting message in the queue
// each       - Method for processing messages from the queue
class Queue {

  constructor({ name, prefixedName, host, port, authenticate, webhookURL, logger }) {
    this.name         = name;
    this.webhookURL   = webhookURL;
    this._logger      = logger;
    this._processing  = false;
    this._handler     = null;

    // Session for storing messages and other manipulations.
    // Setup: tell Beanstalkd which tube to use (persistent to session).
    this._putSession = new Session({ name, host, port, authenticate, logger }, function(client, callback) {
      client.use(prefixedName, callback);
    });

    // Session for processing messages, continously blocks so don't use elsewhere.
    // Setup: tell Beanstalkd which tube we're watching (and ignore default tube).
    this._getSession = new Session({ name, host, port, authenticate, logger }, function(client, callback) {
      client.ignore('default', function() {
        client.watch(prefixedName, callback);
      });
    });
  }


  // Push job to queue.
  put(job, options, callback) {
    assert(job, "Missing job to queue");
    if (typeof(options) == 'function') {
      callback = options;
      options = null;
    }

    let payload = JSON.stringify(job);
    let delay   = (options && options.delay) || 0;

    this._putSession.request('put', 0, delay, PROCESSING_TIMEOUT / 1000, payload, (error, jobID)=> {
      // Don't pass jobID to callback, easy to use in test before hook, like
      // this:
      //   before((done)=> queue.put(MESSAGE, done));
      if (callback)
        callback(error);
      else if (error)
        this._logger.error("Error talking to Beanstalkd, queue %s: %s", this.name, error);
    });
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
  // true if one (or more) jobs were processed.
  once(callback) {
    assert(!this._processing, "Cannot call once while continuously processing jobs");
    if (!this._handler) {
      setImmediate(callback);
      return;
    }

    this._logger.debug("Waiting for jobs on queue %s", this.name);
    this._getSession.request('reserve_with_timeout', 0, (error, jobID, payload)=> {
      if (error == 'TIMED_OUT')
        callback(null, false);
      else if (error)
        callback(error);
      else
        this._processJob(jobID, payload, function(error) {
          callback(error, !error);
        });
    });
  }

  // Calles to process all jobs, until this._processing is set to false.
  _processContinously() {
    // Wait for the next job to become available, call processJob to have it processed, recurse.
    // Never wait if this is the test environment.
    let pickNextJob = ()=> {
      if (!this._processing)
        return;

      this._getSession.request('reserve_with_timeout', RESERVE_TIMEOUT / 1000, (error, jobID, payload)=> {
        if (error == 'DEADLINE_SOON')
          setImmediate(pickNextJob);
        else if (error) {
          this._logger.error(error)
          setImmediate(pickNextJob);
        } else
          this._processContinously(jobID, payload, pickNextJob);
      });
    }

    this._logger.debug("Waiting for jobs on queue %s", this.name);
    pickNextJob();
  }

  // Called to process a job.  If successful, deletes job, otherwise returns job
  // to queue.
  _processJob(jobID, payload, callback) {
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
      this._getSession.request('destroy', jobID, (error)=> {
        if (error)
          this._logger.error(error.stack);
      });
      this._logger.info("Completed job %s from queue %s", jobID, this.name);
      // Move on to process next job.
      clearTimeout(errorOnTimeout);
      callback();
    }, (error)=> {
      // Promise rejected (error or timeout); we release the job back to the
      // queue.  Since this may be a transient error condition (e.g. server
      // down), we let it sit in the queue for a while before it becomes
      // available again.
      let delay = (process.env.NODE_ENV == 'test' ? 0 : RELEASE_DELAY);
      this._getSession.request('release', jobID, 0, delay / 1000, (error)=> {
        if (error)
          this._logger.error(error.stack);
      });
      this._logger.error("Error processing job %s from queue %s: %s", jobID, this.name, error.stack);
      // Move on to process next job.
      clearTimeout(errorOnTimeout);
      callback(error);
    });

    // Run the handler within the domain.  We use domain.intercept, so if
    // function throws exception, calls callback with error, or otherwise
    // has uncaught exception, it emits an error event.
    domain.run(()=> {
      this._logger.info("Picked up job %s from queue %s", jobID, this.name);
      this._logger.debug("Processing %s: %s", jobID, payload.toString());
      // Typically we queue JSON objects, but the payload may be just a
      // string, e.g. some services send URL encoded name/value pairs, or MIME
      // messages.
      let job = payload;
      try {
        job = JSON.parse(payload);
      } catch(ex) { }
      this._handler(job, domain.intercept(function() {
        // Successful completion.
        outcomeDeferred.resolve();
      }));
    });
  }

  // Delete all messages from the queue.
  reset(callback) {
    this._putSession._withClient(function(client) {
      function deleteNextJob() {
        client.reserve_with_timeout(0, function(error, jobID, payload) {
          if (error == 'TIMED_OUT')
            callback();
          else if (error)
            callback(error);
          else
            client.destroy(jobID, deleteNextJob);
        });
      }
      deleteNextJob();
    });
  }

}

