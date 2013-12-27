// Need runtime to support generators.
require(require.resolve('traceur') + '/../../runtime/runtime');

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
    for (var queue of this.queues)
      queue.stop();
  }

  // Stops processing jobs from all queues.
  stop(callback) {
    this.notify.debug("Stop all queues");
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
    var client  = new fivebeans.client(this.config.hostname, this.config.port);

    client.on('error', (error)=> {
      // On error we automatically discard the connection.
      this.notify.info("Client error in queue %s: %s", this.name, error.toString());
      client.end();
    });
    client.on('end', ()=> {
      // Client disconnected
      this._client = null; // will connect again next time
      this.notify.info("Connection closed for %s", this.name);
    });

    // Nothing happens until we start the connection and wait for the connect event.
    client.connect();
    yield (resume)=> client.on('connect', resume);

    // When working with iron.io, need to authenticate each connection before
    // it can be used.  This is the first setup step, followed by the
    // session-specific setup.
    if (this.config.authenticate)
      yield (resume)=> client.put(0, 0, 0, this.config.authenticate, resume);
    
    // Get/put clients have different setup requirements, this are handled by
    // an externally supplied method.
    yield this.setup(client);

    // Every call to `connect` should be able to access this client.
    this._client = client;
    return client;
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
      var tubeName = this._prefixedName;
      session = new Session(this.name, this._server, function*(client) {
        yield (resume)=> client.use(tubeName, resume);
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
      session = new Session(this.name, this._server, function*(client) {
        // Must watch a new tube before we can ignore default tube
        yield (resume)=> client.watch(tubeName, resume);
        yield (resume)=> client.ignore('default', resume);
      });
      this._reserveSessions[index] = session;
    }
    return session;
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
    this.notify.debug("Waiting for jobs on queue %s", this.name);
    co(function*() {
      while (this._processing && this._handlers.length) {

        try {

          var timeout = RESERVE_TIMEOUT / 1000;
          var [jobID, payload] = yield session.request('reserve_with_timeout', timeout);
          yield this._runAndDestroy(session, jobID, payload);

        } catch (error) {

          // No job, go back to wait for next job.
          if (error != 'TIMED_OUT' && (error.message != 'TIMED_OUT')) {
            // Report on any other error, and back off for a few.
            this.notify.emit('error', error);
            yield (resume)=> setTimeout(resume, RESERVE_BACKOFF);
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

}

