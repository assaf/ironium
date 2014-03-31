var assert      = require('assert');
var fivebeans   = require('fivebeans');
var ms          = require('ms');
var runJob      = require('./run_job');


// How long to wait when reserving a job.  Iron.io closes connection if we wait
// too long.
var RESERVE_TIMEOUT     = ms('30s');

// Back-off in case of connection error, prevents continously failing to
// reserve a job.
var RESERVE_BACKOFF     = ms('30s');

// Timeout for processing job before we consider it failed and release it back
// to the queue.
var PROCESSING_TIMEOUT  = ms('10m');

// Delay before a released job is available for pickup again (in seconds).
// This is our primary mechanism for dealing with load during failures.
// Ignored in test environment.
var RELEASE_DELAY       = ms('1m');


function promisify(fn) {
  return new Promise(function(resolve, reject) {
    fn(function(error) {
      if (error)
        reject(error);
      else
        resolve(error);
    });
  });
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
  // id      - Session id, used for error reporting
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
  constructor(server, id, setup) {
    this.id       = id;
    this.setup    = setup;
    this._config  = server.config;
    this._notify  = server.notify;
  }

  // Make a request to the server.
  //
  // command  - The command (e.g. put, get, destroy)
  // args     - Zero or more arguments, depends on command
  //
  // Returns a promise that resolves to single value, or array, depending on
  // command.
  //
  // This is a simple wrapper around the Fivebeans client with additional error
  // handling.
  request(command, ...args) {
    // Ask for connection, we get a promise that resolves into a client.
    // Because callbacks we need to create separate promise, resolved after
    // command executes.
    return this.connect().then(function(client) {

      return new Promise(function(resolve, reject) {

        // If connection ends close/error, Fivebeans never terminates the request,
        // we need to respond to connection error directly.
        function onError(error) {
          reject(error);
        }
        function onClose() {
          // The TIMED_OUT error is appropriate because the request failed to
          // complete in time, and gets silently ignored when reserving jobs.
          reject(new Error('TIMED_OUT'));
        }
        client.once('close', onClose);
        client.once('error', onError);

        client[command].call(client, ...args, function(error, ...results) {
          client.removeListener('close', onClose);
          client.removeListener('error', onError);
          if (error)
            reject(error);
          else if (results.length > 1)
            resolve(results);
          else
            resolve(results[0]);
        });
      });

    });
  }

  // Called to establish a new connection, or use existing connections.
  // Returns a FiveBeans client.
  async connect() {
    // this._client is set after first call to `connect`, and until we detect a
    // connection failure and terminate it.
    if (this._client)
      return this._client;

    // This is the Fivebeans client is essentially a session.
    var config = this._config;
    var client  = new fivebeans.client(config.queues.hostname, config.queues.port);

    try {

      client.on('error', (error)=> {
        // On connection error, we automatically discard the connection.
        if (this._client == client)
          this._client = null;
        this._notify.debug("Client error in queue %s: %s", this.id, error.toString());
        client.end();
      });
      client.on('close', ()=> {
        // Client disconnected
        if (this._client == client)
          this._client = null;
        this._notify.debug("Connection closed for %s", this.id);
      });

      // Nothing happens until we start the connection.  Must wait for
      // connection event before we can send anything down the stream.
      client.connect();
      // Allows the process to exit when done processing, otherwise, it will
      // stay running while it's waiting to reserve the next job.
      client.stream.unref();
      await promisify((callback)=> client.on('connect', callback));

      // When working with Iron.io, need to authenticate each connection before
      // it can be used.  This is the first setup step, followed by the
      // session-specific setup.
      if (config.authenticate)
        await promisify((callback)=> client.put(0, 0, 0, config.authenticate, callback));
      
      // Put/reserve clients have different setup requirements, this are handled by
      // an externally supplied method.
      await promisify((callback)=> this.setup(client, callback));

    } catch (error) {
      // Gracefully terminate connection.
      client.end();
      throw error;
    }

    // Every call to `connect` should be able to access this client.
    this._client = client;
    return client;
  }

  end() {
    if (this._client)
      this._client.end();
    this._client = null;
  }

}


// Abstraction for a queue.  Has two sessions, one for pushing messages, one
// for processing them.
class Queue {

  constructor(server, name) {
    this.name             = name;
    this.webhookURL       = server.config.webhookURL(name);

    this._server          = server;
    this._notify          = server.notify;
    this._prefixedName    = server.config.prefixedName(name);

    this._processing      = false;
    this._handlers        = [];
    this._putSession      = null;
    this._reserveSessions = [];
  }


  // Push job to queue.  If called with one argument, returns a promise.
  push(job, callback) {
    assert(job, "Missing job to queue");

    var priority  = 0;
    var delay     = 0;
    var timeToRun = Math.floor(PROCESSING_TIMEOUT / 1000) + 1;
    var payload   = JSON.stringify(job);
    // Don't pass jobID to callback, easy to use in test before hook, like
    // this:
    //   before(queue.put(MESSAGE));
    var promise = this._put.request('put', priority, delay, timeToRun, payload)
      .then((jobID)=> {
        this._notify.debug("Queued job %s on queue %s", jobID, this.name, payload);
        return jobID;
      });

    if (callback)
      promise.then((jobID)=> callback(null, jobID), callback);
    else
      return promise;
  }

  // Process jobs from queue.
  each(handler, width) {
    assert(typeof handler == 'function', "Called each without a valid handler");
    if (width)
      this._width = width;
    this._handlers.push(handler);

    // It is possible start() was already called, but there was no handler, so
    // this is where we start listening.
    if (this._processing && this._handlers.length == 1)
      for (var i = 0; i < this.width; ++i) {
        var session = this._reserve(i);
        this._processContinously(session);
      }
  }


  // Start processing jobs.
  start() {
    // Don't act stupid if called multiple times.
    if (this._processing)
      return;
    this._processing = true;

    // Only call _processContinously if there are any handlers associated with
    // this queue.  A queue may have no handle (e.g. one process queues,
    // another processes), in which case we don't want to listen on it.
    if (this._handlers.length) {
      for (var i = 0; i < this.width; ++i) {
        var session = this._reserve(i);
        this._processContinously(session);
      }
    }
  }

  // Stop processing jobs.
  stop() {
    this._processing = false;
    for (var session of this._reserveSessions)
      session.end();
    this._reserveSessions.length = 0;
  }

  // Number of workers to run in parallel.
  get width() {
    return this._width || this._server.config.width || 1;
  }


  // Called to process all jobs in this queue.  Returns a promise that resolves
  // to true if any job was processed.
  once() {
    assert(!this._processing, "Cannot call once while continuously processing jobs");
    if (!this._handlers.length)
      return Promise.resolve();

    this._notify.debug("Waiting for jobs on queue %s", this.name);
    var session = this._reserve(0);
    var anyProcessed = false;
    var timeout = 0;

    var reserveAndProcess = ()=> {
      return session.request('reserve_with_timeout', timeout)
        .then(([jobID, payload])=> this._runAndDestroy(session, jobID, payload) )
        .then(()=> {
          anyProcessed = true;
          return reserveAndProcess();
        })
        .catch((error)=> {
          if (error == 'TIMED_OUT' || (error && error.message == 'TIMED_OUT'))
            return anyProcessed;
          else
            throw error;
        });
    };
    return reserveAndProcess();
  }

  // Called to process all jobs, until this._processing is set to false.
  async _processContinously(session) {
    // Don't do anything without a handler, stop when processing is false.
    if (this._processing && this._handlers.length)
      this._notify.debug("Waiting for jobs on queue %s", this.name);

    while (this._processing && this._handlers.length) {

      try {

        var timeout = RESERVE_TIMEOUT / 1000;
        var [jobID, payload] = await session.request('reserve_with_timeout', timeout);
        await this._runAndDestroy(session, jobID, payload);

      } catch (error) {

        if (error == 'TIMED_OUT' || error.message == 'TIMED_OUT') {
          // No job, go back to wait for next job.
        } else {
          // Report on any other error, and back off for a few.
          this._notify.error(error);
          var backoff = (process.env.NODE_ENV == 'test' ? 0 : RESERVE_BACKOFF);
          await new Promise(function(resolve) {
            setTimeout(resolve, backoff);
          });
        }

      }

    }
  }


  // Called to process a job.  If successful, deletes job, otherwise returns job
  // to queue.  Returns a promise.
  _runAndDestroy(session, jobID, payload) {
    // Payload comes in the form of a buffer, need to conver to a string.
    payload = payload.toString();
    // Typically we queue JSON objects, but the payload may be just a
    // string, e.g. some services send URL encoded name/value pairs, or MIME
    // messages.
    try {
      payload = JSON.parse(payload);
    } catch(ex) {
    }

    this._notify.info("Processing queued job %s:%s", this.name, jobID);
    this._notify.debug("Payload for job %s:%s:", this.name, jobID, payload);

    var handlers = this._handlers.map(function(handler) {
      return runJob(handler, [payload], PROCESSING_TIMEOUT);
    });
    var runAll = Promise.all(handlers)
      .then(()=> {
        this._notify.info("Completed queued job %s:%s", this.name, jobID);
        // Remove job from queue, swallow error
        return session.request('destroy', jobID)
          .catch(()=> this._notify.info("Could not delete job %s:%s", this.name, jobID) );
      })
      .catch((error)=> {
        this._notify.info("Error processing queued job %s:%ss", this.name, jobID, error.stack);
        // Error or timeout: we release the job back to the queue.  Since this
        // may be a transient error condition (e.g. server down), we let it sit
        // in the queue for a while before it becomes available again.
        var priority = 0;
        var delay = (process.env.NODE_ENV == 'test' ? 0 : Math.floor(RELEASE_DELAY / 1000));
        session.request('release', jobID, priority, delay);
        throw error;
      });

    return runAll;
  }

  // Delete all messages from the queue.
  async reset() {
    // We're using the _put session (use), the _reserve session (watch) doesn't
    // return any jobs.
    var session = this._put;
    var jobID;
    var payload;

    // Delete all ready jobs.
    try {
      while (true) {
        [jobID, payload] = await session.request('peek_ready');
        await session.request('destroy', jobID);
      }
    } catch (error) {
      if (error != 'NOT_FOUND')
        throw error;
    }

    // Delete all delayed jobs.
    try {
      while (true) {
        [jobID, payload] = await session.request('peek_delayed');
        await session.request('destroy', jobID);
      }
    } catch (error) {
      if (error != 'NOT_FOUND')
        throw error;
    }
    return;
  }


  // Session for storing messages and other manipulations, created lazily
  get _put() {
    var session = this._putSession;
    if (!session) {
      // Setup: tell Beanstalkd which tube to use (persistent to session).
      var tubeName = this._prefixedName;
      session = new Session(this._server, this.name + '/put', function(client, callback) {
        client.use(tubeName, callback);
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
      var tubeName = this._prefixedName;
      session = new Session(this._server, this.name + '/' + index, function(client, callback) {
        // Must watch a new tube before we can ignore default tube
        client.watch(tubeName, function(error1) {
          client.ignore('default', function(error2) {
            callback(error1 || error2);
          });
        });
      });
      this._reserveSessions[index] = session;
    }
    return session;
  }

}


// Abstracts the queue server.
module.exports = class Server {

  constructor(ironium) {
    // We need this to automatically start any queue added after ironium.start().
    this.started  = false;

    this._ironium = ironium;
    this._queues  = Object.create({});
  }

  // Returns the named queue, queue created on demand.
  getQueue(name) {
    assert(name, "Missing queue name");
    var queue = this._queues[name];
    if (!queue) {
      queue = new Queue(this, name);
      this._queues[name] = queue;
      if (this.started)
        queue.start();
    }
    return queue;
  }

  // Starts processing jobs from all queues.
  start() {
    this.notify.debug("Start all queues");
    this.started = true;
    for (var queue of this.queues)
      queue.start();
  }

  // Stops processing jobs from all queues.
  stop() {
    this.notify.debug("Stop all queues");
    this.started = false;
    for (var queue of this.queues)
      queue.stop();
  }

  // Use when testing to empty contents of all queues.
  reset() {
    this.notify.debug("Clear all queues");
    var queues = this.queues.map((queue)=> queue.reset());
    return Promise.all(queues);
  }

  // Use when testing to wait for all jobs to be processed.
  once() {
    var queues    = this.queues.map((queue)=> queue.once());
    var allQueues = Promise.all(queues).
      then((processed)=> {
        var anyProcessed = (processed.indexOf(true) >= 0);
        if (anyProcessed)
          return this.once();
      });
    return allQueues;
  }

  // Returns an array of all queues.
  get queues() {
    return Object.keys(this._queues).map((name)=> this._queues[name]);
  }

  get config() {
    // Lazy load configuration.
    return this._ironium.config;
  }

  get notify() {
    return this._ironium;
  }
};

