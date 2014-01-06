const assert      = require('assert');
const co          = require('co');
const fivebeans   = require('fivebeans');
const ms          = require('ms');
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


// Abstracts the queue server.
module.exports = class Server {

  constructor(workers) {
    this._workers = workers;
    this._queues  = Object.create({});
    // We need this to automatically start any queue added after workers.start().
    this.started  = false;
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
  stop(callback) {
    this.notify.debug("Stop all queues");
    this.started = false;
    for (var queue of this.queues)
      queue.stop();
  }

  // Use when testing to empty contents of all queues.
  *reset() {
    this.notify.debug("Clear all queues");
    for (var queue of this.queues)
      yield queue.reset();
  }

  // Use when testing to wait for all jobs to be processed.
  *once() {
    do {
      var processed = yield this.queues.map((queue)=> queue.once());
      var anyProcessed = (processed.indexOf(true) >= 0);
    } while (anyProcessed);
  }

  // Returns an array of all queues.
  get queues() {
    return Object.keys(this._queues).map((name)=> this._queues[name]);
  }

  get config() {
    return this._workers.config;
  }

  get notify() {
    return this._workers;
  }

}


// Abstraction for a queue.  Has two sessions, one for pushing messages, one
// for processing them.
class Queue {

  constructor(server, name) {
    this.name           = name;
    this.webhookURL     = server.config.webhookURL(name);

    this._server          = server;
    this._processing      = false;
    this._handlers        = [];
    this._putSession      = null;
    this._reserveSessions = [];
  }


  // Push job to queue.  If called with one argument, returns a thunk.
  // is not queued until thunk is called.
  push(job, callback) {
    assert(job, "Missing job to queue");
    var thunk = co(function*() {

      var priority  = 0;
      var delay     = 0;
      var timeToRun = Math.floor(PROCESSING_TIMEOUT / 1000) + 1;
      var payload   = JSON.stringify(job);
      // Don't pass jobID to callback, easy to use in test before hook, like
      // this:
      //   before(queue.put(MESSAGE));
      var jobID = yield this._put.request('put', priority, delay, timeToRun, payload);
      this.notify.debug("Queued job %s on queue %s", jobID, this.name, payload);

    }.call(this));
    if (callback)
      thunk(callback);
    else
      return thunk;
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


  // Called to process all jobs in this queue, and return when empty.
  *once() {
    assert(!this._processing, "Cannot call once while continuously processing jobs");
    if (!this._handlers.length)
      return false;

    this.notify.debug("Waiting for jobs on queue %s", this.name);
    var session = this._reserve(0);
    var anyProcessed = false;
    try {
      while (true) {
        var timeout = 0;
        var [jobID, payload] = yield session.request('reserve_with_timeout', timeout);
        yield this._runAndDestroy(session, jobID, payload);
        anyProcessed = true;
      }
    } catch (error) {
      if (error == 'TIMED_OUT' || (error && error.message == 'TIMED_OUT'))
        return anyProcessed;
      else
        throw error;
    }
  }

  // Called to process all jobs, until this._processing is set to false.
  _processContinously(session) {
    // Don't do anything without a handler, stop when processing is false.
    if (this._processing && this._handlers.length)
      this.notify.debug("Waiting for jobs on queue %s", this.name);
    co(function*() {
      while (this._processing && this._handlers.length) {

        try {

          var timeout = RESERVE_TIMEOUT / 1000;
          var [jobID, payload] = yield session.request('reserve_with_timeout', timeout);
          yield this._runAndDestroy(session, jobID, payload);

        } catch (error) {


          // No job, go back to wait for next job.
          if (error != 'TIMED_OUT' && error.message != 'TIMED_OUT') {
            // Report on any other error, and back off for a few.
            this.notify.emit('error', error);
            var backoff = (process.env.NODE_ENV == 'test' ? 0 : RESERVE_BACKOFF);
            yield (resume)=> setTimeout(resume, backoff);
          }

        }

      }
    }.call(this))();
  }


  // Called to process a job.  If successful, deletes job, otherwise returns job
  // to queue.
  *_runAndDestroy(session, jobID, payload) {
    try {

      // Payload comes in the form of a buffer, need to conver to a string.
      payload = payload.toString();
      // Typically we queue JSON objects, but the payload may be just a
      // string, e.g. some services send URL encoded name/value pairs, or MIME
      // messages.
      try {
        payload = JSON.parse(payload);
      } catch(ex) {
      }

      this.notify.info("Processing queued job %s:%s", this.name, jobID);
      this.notify.debug("Payload for job %s:%s:", this.name, jobID, payload);
      for (var handler of this._handlers)
        yield (resume)=> runJob(handler, [payload], PROCESSING_TIMEOUT, resume);
      this.notify.info("Completed queued job %s:%s", this.name, jobID);

      try {
        yield session.request('destroy', jobID);
      } catch (error) {
        this.notify.info("Could not delete job %s:%s", this.name, jobID);
      }

    } catch (error) {

      this.notify.info("Error processing queued job %s:%ss", this.name, jobID, error.stack);
      // Error or timeout: we release the job back to the queue.  Since this
      // may be a transient error condition (e.g. server down), we let it sit
      // in the queue for a while before it becomes available again.
      var priority = 0;
      var delay = (process.env.NODE_ENV == 'test' ? 0 : Math.floor(RELEASE_DELAY / 1000));
      yield session.request('release', jobID, priority, delay);
      throw error;

    }
  }

  // Delete all messages from the queue.
  *reset() {
    // We're using the _put session (use), the _reserve session (watch) doesn't
    // return any jobs.
    var session = this._put;

    // Delete all ready jobs.
    try {
      while (true) {
        var jobID = yield session.request('peek_ready');
        yield session.request('destroy', jobID);
      }
    } catch (error) {
      if (error != 'NOT_FOUND')
        throw error;
    }

    // Delete all delayed jobs.
    try {
      while (true) {
        var jobID = yield session.request('peek_delayed');
        yield session.request('destroy', jobID);
      }
    } catch (error) {
      if (error != 'NOT_FOUND')
        throw error;
    }
  }


  // Session for storing messages and other manipulations, created lazily
  get _put() {
    var session = this._putSession;
    if (!session) {
      // Setup: tell Beanstalkd which tube to use (persistent to session).
      var tubeName = this.prefixedName;
      session = new Session(this._server, this.name, function*(client) {
        yield (resume)=> client.use(tubeName, resume);
        // Allow the program to exit if the only active connections are for
        // queuing jobs (no listeners).
        client.stream.unref();
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
      var tubeName = this.prefixedName;
      session = new Session(this._server, this.name, function*(client) {
        // Must watch a new tube before we can ignore default tube
        yield (resume)=> client.watch(tubeName, resume);
        yield (resume)=> client.ignore('default', resume);
      });
      this._reserveSessions[index] = session;
    }
    return session;
  }


  get notify() {
    return this._server.notify;
  }

  get prefixedName() {
    return this._server.config.prefixedName(this.name);
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
  constructor(server, name, setup) {
    this.name     = name;
    this._server  = server;
    this._setup   = setup;
  }

  // Make a request to the server.
  //
  // command  - The command (e.g. put, get, destroy)
  // args     - Zero or more arguments, depends on command
  //
  // This is a simple wrapper around the Fivebeans client with additional error
  // handling.
  *request(command, ...args) {
    // Wait for connection, need open client to send request.
    var client  = yield this.connect();
    var results = yield function(resume) {
      // Catch commands that don't complete in time.  If the connection
      // breaks for any reason, Fivebeans never calls the callback, the only
      // way we can handle this condition is with a timeout.
      var completed = false;
      var requestTimeout = setTimeout(function() {
        if (!completed) {
          completed = true;
          resume('TIMED_OUT');
        }
      }, TIMEOUT_REQUEST);
      client[command].call(client, ...args, function(error, ...results) {
        if (!completed) {
          completed = true;
          clearTimeout(requestTimeout);
          resume(error, results);
        }
      });
    }
    return results && (results.length > 1 ? results : results[0]);
  }

  // Called to establish a new connection, or use existing connections.
  // Returns a FiveBeans client.
  *connect(callback) {
    // this._client is set after first call to `connect`, and until we detect a
    // connection failure and terminate it.
    if (this._client)
      return this._client;

    // This is the Fivebeans client is essentially a session.
    var client  = new fivebeans.client(this.config.queues.hostname, this.config.queues.port);

    try {

      client.on('error', (error)=> {
        // On connection error, we automatically discard the connection.
        if (this._client == client)
          this._client = null;
        this.notify.info("Client error in queue %s: %s", this.name, error.toString());
        client.end();
      });
      client.on('close', ()=> {
        // Client disconnected
        if (this._client == client)
          this._client = null;
        this.notify.info("Connection closed for %s", this.name);
      });

      // Nothing happens until we start the connection.  Must wait for
      // connection event before we can send anything down the stream.
      client.connect();
      yield (resume)=> client.on('connect', resume);

      // When working with Iron.io, need to authenticate each connection before
      // it can be used.  This is the first setup step, followed by the
      // session-specific setup.
      if (this.config.authenticate)
        yield (resume)=> client.put(0, 0, 0, this.config.authenticate, resume);
      
      // Put/reserve clients have different setup requirements, this are handled by
      // an externally supplied method.
      yield this._setup(client);

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

  get config() {
    return this._server.config;
  }

  get notify() {
    return this._server.notify;
  }

}

