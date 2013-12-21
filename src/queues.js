const assert      = require('assert');
const fivebeans   = require('fivebeans');
const ms          = require('ms');
const { Promise } = require('es6-promise');
const runJob      = require('./run_job');


// How long to wait when reserving a job.  Iron.io terminates connection after
// 1 minute, so that's the longest we can wait without having to continously
// reopen connctions.
const RESERVE_TIMEOUT     = ms('30s');

// Back-off in case of connection error, prevents continously failing to
// reserve a job.
const RESERVE_BACKOFF     = ms('30s');

// How long before we consider a request failed due to timeout.
// Should be longer than RESERVE_TIMEOUT.
const TIMEOUT_REQUEST     = RESERVE_TIMEOUT + ms('10s');

// Timeout for processing job before we consider it failed and release it back
// to the queue.
const PROCESSING_TIMEOUT  = ms('10m');

// Delay before a released job is available for pickup again (in seconds).
// This is our primary mechanism for dealing with load during failures.
// Ignored in test environment.
const RELEASE_DELAY       = ms('1m');


class Configuration {
  constructor(workers) {
    this._workers = workers;
  }

  get config() {
    var config = this._config;
    if (!config) {
      var source = this._workers._config && this._workers._config.queues;
      if (!source)
        source = (process.env.NODE_ENV == 'test') ? { prefix: 'test-' } : {};
      this._config = config = {
        hostname: source.hostname || 'localhost',
        port:     source.port     || 11300,
        prefix:   source.prefix,
        width:    source.width    || 1
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

  get width() {
    return this.config.width;
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
    var queue = this._queues[name];
    if (!queue) {
      queue = new Queue(name, this);
      this._queues[name] = queue;
    }
    return queue;
  }

  // Starts processing jobs from all queues.
  start() {
    this.notify.debug("Start all queues");
    for (var name in this._queues) {
      var queue = this._queues[name];
      queue.start();
    }
  }

  // Stops processing jobs from all queues.
  stop(callback) {
    this.notify.debug("Stop all queues");
    for (var name in this._queues) {
      var queue = this._queues[name];
      queue.stop();
    }
  }

  // Use when testing to empty contents of all queues.  Returns a promise.
  reset() {
    this.notify.debug("Clear all queues");
    var promises = Object.keys(this._queues)
      .map((name)=> this._queues[name])
      .map((queue)=> queue.reset());
    return Promise.all(promises).then(()=> undefined);
  }

  // Use when testing to wait for all jobs to be processed.  Returns a promise.
  once() {
    this.notify.debug("Process all queued jobs");
    var queues = Object.keys(this._queues)
      .map((name)=> this._queues[name]);

    function runAllJobsOnce() {
      var promises = queues.map((queue)=> queue.once());
      var runOnce = Promise.all(promises);
      return runOnce.then((processed)=> {
        // If any queue has processed a job, repeat, otherwise all queues are
        // empty.
        var anyProcessed = processed.indexOf(true) >= 0;
        if (anyProcessed)
          return runAllJobsOnce();
      });
    }
    return runAllJobsOnce();
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
    var connection = this.connect();
    var response = new Promise(function(resolve, reject) {
      // Wait for connection, need open client to send request.
      connection.then(function(client) {

        // Catch commands that don't complete in time.  If the connection
        // breaks for any reason, Fivebeans never calls the callback, the only
        // way we can handle this condition is with a timeout.
        var requestTimeout = setTimeout(function() {
          reject('TIMED_OUT');
        }, TIMEOUT_REQUEST);

        client[command].call(client, ...args, function(error, ...results) {
          clearTimeout(requestTimeout);
          if (error)
            reject(error);
          else if (results.length > 1)
            resolve(results);
          else
            resolve(results[0]);
        });

      }, reject);
    });
    return response;
  }

  // Called to establish a new connection, returns a promise that would resolve
  // to Fivebeans client.
  connect() {
    // this.promise is set after first call to `connect`, and until we detect a
    // connection failure and terminate it.
    if (this.promise)
      return this.promise;

    // This is the Fivebeans client is essentially a session.
    var client  = new fivebeans.client(this.config.hostname, this.config.port);
    var promise = new Promise((resolve, reject)=> {

      // When working with iron.io, need to authenticate each connection before
      // it can be used.  This is the first setup step, followed by the
      // session-specific setup.
      var authenticateAndSetup = ()=> {
        if (this.config.authenticate) {
          client.put(0, 0, 0, this.config.authenticate, function(error) {
            if (error)
              client.emit('error', error);
            else
              setupAndResolve();
          });
        } else
          setupAndResolve();
      }

      // Get/put clients have different setup requirements, this are handled by
      // an externally supplied method.  Once completed, the promise is resolved.
      var setupAndResolve = ()=> {
        this.setup(client, (error)=> {
          if (error)
            client.emit('error', error);
          else
            resolve(client);
        });
      }

      // First listen to the connection events, then attempt to connect.  This
      // will take us through the authenticate, setup and resolve path.
      client
        .on('connect', authenticateAndSetup)
        .on('error', (error)=> {
          // Discard this connection
          this.promise = null; // will connect again next time
          reject(error);
          this.notify.info("Client error in queue %s: %s", this.name, error.toString());
          client.end();
        })
        .on('close', ()=> {
          // Discard this connection
          this.promise = null; // will connect again next time
          reject(error);
          this.notify.info("Connection closed for %s", this.name);
          client.end();
        });

      // Nothing happens until we start the connection.
      client.connect();

    });

    // Every call to `connect` should be able to access this promise.
    this.promise = promise;
    return promise;
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

    this._processing      = false;
    this._handlers        = [];
    this._putSession      = null;
    this._reserveSessions = [];
  }


  // Session for storing messages and other manipulations, created lazily
  get _put() {
    var session = this._putSession;
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
  _reserve(index) {
    var session = this._reserveSessions[index];
    if (!session) {
      // Setup: tell Beanstalkd which tube we're watching (and ignore default tube).
      session = new Session(this.name, this._server, (client, callback)=> {
        client.ignore('default', ()=> {
          client.watch(this._prefixedName, callback);
        });
      });
      this._reserveSessions[index] = session;
    }
    return session;
  }


  // Push job to queue.
  push(job, callback) {
    assert(job, "Missing job to queue");

    var priority  = 0;
    var delay     = 0;
    var timeToRun = Math.floor(PROCESSING_TIMEOUT / 1000);
    var payload   = JSON.stringify(job);
    var promise   = this._put.request('put', priority, delay, timeToRun, payload);
    if (callback) {
      // Don't pass jobID to callback, easy to use in test before hook, like
      // this:
      //   before((done)=> queue.put(MESSAGE, done));
      promise.then(()=> callback(), callback);
    } else
      return promise;
  }

  // Process jobs from queue.
  each(handler, width) {
    assert(typeof handler == 'function', "Called each without a valid handler");
    this._handlers.push(handler);
    if (width)
      this._width = width;
    if (this._processing)
      this.start();
  }


  // Start processing jobs.
  start() {
    this._processing = true;
    for (var i = 0; i < this.width; ++i) {
      var session = this._reserve(i);
      this._processContinously(session);
    }
  }

  // Stop processing jobs.
  stop() {
    this._processing = false;
  }

  // Number of workers to run in parallel.
  get width() {
    return this._width || this._server.config.width || 1;
  }


  // Called to process a single job.  Returns a promise which resolves to true
  // if any job was processed.
  once() {
    assert(!this._processing, "Cannot call once while continuously processing jobs");
    if (!this._handlers.length)
      return Promise.resolve(false);

    this.notify.debug("Waiting for jobs on queue %s", this.name);
    if (this.width == 1) {
      // Common case, one worker for the queue.
      var session = this._reserve(0);
      return this._processOnce(session);
    } else {
      // But you can also test with multiple concurrent workers.
      var promises = []
      for (var i = 0; i < this.width; ++i) {
        var session = this._reserve(i);
        promises.push(this._processOnce(session));
      }

      // The promise should resolve to true if any job (in any worker) get processed.
      var anyProcessed = Promise.all(promises)
        .then((processed)=> processed.indexOf(true) >= 0);
      return anyProcessed;
    }
  }

  // Called to process all jobs exactly once.
  _processOnce(session) {
    var timeout = 0;
    var reserve = session.request('reserve_with_timeout', timeout);
    return reserve
      // If we reserved a job, this will run the job and delete it.
      .then(([jobID, payload])=> this._runAndDestroy(session, jobID, payload) )
      // Reserved/ran/deleted job, so resolve to true.
      .then(()=> true)
      .catch((error)=> {
        // No job, resolve to false; reject on any other error.
        if (error == 'TIMED_OUT' || (error && error.message == 'TIMED_OUT'))
          return false;
        else
          throw error;
      });
  }

  // Called to process all jobs, until this._processing is set to false.
  _processContinously(session) {
    // Don't do anything without a handler, stop when processing is false.
    if (!(this._processing && this._handlers.length))
      return;

    var repeat = this._processContinously.bind(this, session);

    this.notify.debug("Waiting for jobs on queue %s", this.name);
    var timeout = RESERVE_TIMEOUT / 1000;
    var reserve = session.request('reserve_with_timeout', timeout);

    reserve 
      // If we reserved a job, this will run the job and delete it.
      .then(([jobID, payload])=> this._runAndDestroy(session, jobID, payload) )
      // Reserved/ran/deleted job, repeat to next job.
      .then(()=> setImmediate(repeat))
      .catch((error)=> {
        // No job, go back to wait for next job.
        if (error == 'TIMED_OUT' || (error && error.message == 'TIMED_OUT')) {
          setImmediate(repeat);
        } else {
          // Report on any other error, and back off for a few.
          this.notify.emit('error', error);
          setTimeout(repeat, RESERVE_BACKOFF);
        }
      });
  }


  // Called to process a job.  If successful, deletes job, otherwise returns job
  // to queue.  Returns a promise.
  _runAndDestroy(session, jobID, payload) {
    // Payload comes in the form of a buffer, need to conver to a string.
    var runningJob = this._runJob(jobID, payload.toString());
    return runningJob.then(

      ()=> session.request('destroy', jobID),
      (error)=> {
        // Promise rejected (error or timeout); we release the job back to the
        // queue.  Since this may be a transient error condition (e.g. server
        // down), we let it sit in the queue for a while before it becomes
        // available again.
        var priority = 0;
        var delay = (process.env.NODE_ENV == 'test' ? 0 : Math.floor(RELEASE_DELAY / 1000));
        session.request('release', jobID, priority, delay);
      });
  }

  _runJob(jobID, payload) {
    var jobSpec = {
      id:       [this.name, jobID].join(':'),
      notify:   this.notify,
      handlers: this._handlers,
      timeout:  PROCESSING_TIMEOUT - ms('1s')
    };
    // Typically we queue JSON objects, but the payload may be just a
    // string, e.g. some services send URL encoded name/value pairs, or MIME
    // messages.
    try {
      var job = JSON.parse(payload);
      this.notify.debug("Processing job %s", jobSpec.id, job);
      return runJob(jobSpec, job);
    } catch(ex) {
      this.notify.debug("Processing job %s", jobSpec.id, payload);
      return runJob(jobSpec, payload);
    }
  }


  // Delete all messages from the queue.  Returns a promise.
  reset() {
    // We're using the _put session (use), the _reserve session (watch) doesn't
    // return any jobs.
    var session = this._put;
    var promise = new Promise(function(resolve, reject) {

      // Delete all ready jobs, then call deleteDelayed.
      function deleteReadyJob() {
        session.request('peek_ready')
          .then(([jobID, payload])=> session.request('destroy', jobID) )
          .then(deleteReadyJob, (error)=> {
            if (error == 'NOT_FOUND')
              deleteDelayedJob();
            else
              reject(error);
          });
      }

      // Delete all delayed job, then resolve promise.
      function deleteDelayedJob() {
        session.request('peek_delayed')
          .then(([jobID, payload])=> session.request('destroy', jobID) )
          .then(deleteDelayedJob, (error)=> {
            if (error == 'NOT_FOUND')
              resolve(); // And we're done
            else
              reject(error);
          });
      }

      deleteReadyJob();

    });

    return promise;
  }

}

