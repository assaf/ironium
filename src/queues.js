const assert        = require('assert');
const Bluebird      = require('bluebird');
const { deprecate } = require('util');
const fivebeans     = require('fivebeans');
const ms            = require('ms');
const Promise       = require('bluebird');
const runJob        = require('./run_job');


// How long to wait establishing a new connection.
const CONNECT_TIMEOUT       = ms('5s');

// How long to wait when reserving a job.  Iron.io closes connection if we wait
// too long.
const RESERVE_TIMEOUT       = ms('30s');

// Back-off in case of connection error, prevents continously failing to
// reserve a job.
const RESERVE_BACKOFF       = ms('30s');

// Timeout for processing job before we consider it failed and release it back
// to the queue.
const PROCESSING_TIMEOUT    = ms('10m');

// Delay before a released job is available for pickup again (in seconds).
// This is our primary mechanism for dealing with load during failures.
// Ignored in test environment.
const RELEASE_DELAY         = ms('1m');

// In testing environment, delay() is artifically limited to this duration.
const MAX_DELAY_FOR_TESTING = ms('10s');


// Returns actual timeout in production.  If NODE_ENV is development or test,
// return a timeout no larger than the limit (default to zero).
function ifProduction(timeout, limit = 0) {
  return (/^(development|test)$/.test(process.env.NODE_ENV)) ?  Math.min(limit, timeout) : timeout;
}

// Convert milliseconds (JS time) to seconds (Beanstalked time).
function msToSec(ms) {
  return Math.round(ms / 1000);
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

    this._clientPromise = null;
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
    // We return a new promise that resolves to the output of the request.
    return this.connect()
      .then((client)=> {
        return new Promise((resolve, reject)=> {
          // Processing (continously or not) know to ignore the TIMED_OUT
          // and CLOSED errors.

          // When Fivebeans client executes a command, it doesn't monitor for
          // connection close/error, so we need to catch these events ourselves
          // and reject the promise.
          const onConnectionEnded = (error)=> {
            reject(error || new Error('CLOSED'));
            this._notify.debug(this.id, '=>', command, error || 'CLOSED');
          }

          client.once('close', onConnectionEnded);
          client.once('error', onConnectionEnded);

          this._notify.debug(this.id, '$', command, ...args);
          client[command].call(client, ...args, (error, ...results)=> {
            // This may never get called
            this._notify.debug(this.id, '=>', command, error, ...results);
            client.removeListener('close', onConnectionEnded);
            client.removeListener('error', onConnectionEnded);

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
  // Returns a promise that resolves to a FiveBeans client.
  connect() {
    if (this._clientPromise)
      return this._clientPromise;

    // This is the Fivebeans client is essentially a session.
    const config  = this._config;
    const client  = new fivebeans.client(config.queues.hostname, config.queues.port);
    // For when we have a lot of writers contending to push to the same queue.
    client.setMaxListeners(0);

    // This promise resolves when client connects.
    const connected = new Promise(function(resolve, reject) {
      // Nothing happens until we start the connection.  Must wait for
      // connection event before we can send anything down the stream.
      client.connect();
      // Allows the process to exit when done processing, otherwise, it will
      // stay running while it's waiting to reserve the next job.
      client.stream.unref();

      client.on('connect', resolve);
      client.on('error', reject);
      client.on('close', function() {
        reject(new Error('CLOSED'));
      });
    });

    // When working with Iron.io, need to authenticate each connection before
    // it can be used.  This is the first setup step, followed by the
    // session-specific setup.
    let authenticated;
    if (config.authenticate) {
      authenticated = connected.then(()=> Bluebird.promisify(client.put, client)(0, 0, 0, config.authenticate) );
    } else
      authenticated = connected;

    // Put/reserve clients have different setup requirements, this are handled by
    // an externally supplied method.
    const setup = authenticated.then(()=> Bluebird.promisify(this.setup, this)(client) );

    // If we can't establish a connection of complete the authentication/setup
    // step, and Fivebeans doesn't trigger an error.
    const timeout = setTimeout(function() {
      client.emit('error', new Error('TIMED_OUT'));
      client.end();
    }, CONNECT_TIMEOUT);
    timeout.unref();

    // This promise resolves when we're done establishing a connection.
    // Multiple request will wait on this.
    const clientPromise = setup
      .then(()=> clearTimeout(timeout))
      .then(()=> client)
      .catch((error)=> {
        // Failed to establish connection, dissociate _clientPromise and attempt
        // to connect again.
        this._notify.debug('Client error in queue %s: %s', this.id, error.toString());
        client.emit('error', error);
        client.end();
        throw error;
      });

    // When this method returns, _clientPromise is set but we still haven't
    // established a connection, so none of these had a change to trigger.
    client.once('error', (error)=> {
      // Connection has been closed. Disassociate from session.
      this.end();
      this._notify.debug('Client error in queue %s: %s', this.id, error.toString());
    });
    client.once('close', ()=> {
      // Connection has been closed. Disassociate from session.
      this.end();
      this._notify.debug('Connection closed for %s', this.id);
    });

    // This promise available to all subsequent requests, until error/close
    // event disassociates it.
    this._clientPromise = clientPromise;
    return clientPromise;
  }

  // Close this session
  end() {
    if (this._clientPromise) {
      this._clientPromise.done((client)=> {
        client.end();
        client.emit('close');
      });
    }
    this._clientPromise = null;
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

    this._config          = server.config.queues;
    this._width           = server.config.width || 1;
  }

  // Push job to queue.  If called with one argument, returns a promise.
  pushJob(job, callback) {
    return this.delayJob(job, 0, callback);
  }

  // Push job to queue with the given delay.  Delay can be millisecond,
  // or a string of the form '5s', '2m', etc.  If called with two arguments,
  // returns a promise.
  delayJob(job, duration, callback) {
    assert(job, 'Missing job to queue');
    assert(duration.toString, 'Delay must be string or number');
    // Converts '5m' to 300 seconds.  The toString is necessary to handle
    // numbers properly, since ms(number) -> string.
    duration = ifProduction( ms(duration.toString()), this._config.maxDelay || 0 );

    const priority  = 0;
    const timeToRun = PROCESSING_TIMEOUT;
    const payload   = (Buffer.isBuffer(job) || typeof(job) === 'string') ? job : JSON.stringify(job);
    // Don't pass jobID to callback, easy to use in test before hook, like
    // this:
    //   before(queue.put(MESSAGE));
    const promise = this._put
      .request('put', priority, msToSec(duration), msToSec(timeToRun), payload)
      .then((jobID)=> {
        this._notify.debug('Queued job %s on queue %s', jobID, this.name, payload);
        return jobID;
      });

    if (callback)
      promise.done((jobID)=> callback(null, jobID), callback);
    else
      return promise;
  }

  // Process jobs from queue.
  eachJob(handler, width) {
    assert(typeof(handler) === 'function', 'Called each without a valid handler');
    if (width)
      this._width = width;
    this._handlers.push(handler);

    // It is possible start() was already called, but there was no handler, so
    // this is where we start listening.
    if (this._processing && this._handlers.length === 1)
      for (let i = 0; i < this.width; ++i) {
        let session = this._reserve(i);
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
      for (let i = 0; i < this.width; ++i) {
        let session = this._reserve(i);
        this._processContinously(session);
      }
    }
  }

  // Stop processing jobs.
  stop() {
    this._processing = false;
    for (let session of this._reserveSessions)
      session.end();
    this._reserveSessions.length = 0;
  }


  // Number of workers to run in parallel.
  get queueWidth() {
    return this._width;
  }

  // DEPRECATED
  get width() {
    return this._width;
  }


  // Called to process all jobs in this queue.  Returns a promise that resolves
  // to true if any job was processed.
  runOnce() {
    assert(!this._processing, 'Cannot call once while continuously processing jobs');
    if (!this._handlers.length)
      return Promise.resolve();

    this._notify.debug('Waiting for jobs on queue %s', this.name);
    return this._reserveAndProcess();
  }


  // Used by once to reserve and process each job recursively.
  _reserveAndProcess() {
    const session = this._reserve(0);
    const timeout = 0;

    return session
      .request('reserve_with_timeout', timeout)
      .then(([jobID, payload])=> this._runAndDestroy(session, jobID, payload) )
      .then(()=> this._reserveAndProcess() )
      .then(()=> true ) // At least one job processed, resolve to true
      .catch((error)=> {
        const reason = (error && error.message) || error;
        if (/^(TIMED_OUT|CLOSED|DRAINING)$/.test(reason))
          return false; // Job not processed
        else
          throw error;
      });
  }

  // Called to process all jobs, until this._processing is set to false.
  _processContinously(session) {
    const queue   = this;
    const backoff = ifProduction(RESERVE_BACKOFF);

    function nextJob() {
      if (!queue._processing || queue._handlers.length === 0)
        return;

      // Reserve job and resolve
      const reserve       = session.request('reserve_with_timeout', msToSec(RESERVE_TIMEOUT));
      // Run job and delete it and resolve
      const runAndDestory = reserve.then(([jobID, payload])=> queue._runAndDestroy(session, jobID, payload) );
      // Handle errors and resolve.
      const handleError   = runAndDestory
        .catch(function(error) {
          // Reject can take anything, including false, undefined.
          const reason = (error && error.message) || error;
          if (/^(TIMED_OUT|CLOSED|DRAINING)$/.test(reason)) {
            // No job, go back to wait for next job.
          } else {
            // Report on any other error, and back off for a few.
            queue._notify.debug('Error processing job, backing off', error.stack);
            return new Promise(function(resolve) {
              const timeout = setTimeout(resolve, backoff);
              timeout.unref();
            });

          }
        });

      // Run next job with a timeout and resolve.  Beanstalkd client fails in
      // mysterious ways, and only way to process continously for long is to use
      // timesouts.
      const withTimeout = new Promise(function(resolve, reject) {
        const timeout = setTimeout(function() {
          session.end();
          reject(new Error(`Timeout in processContinously for ${queue.name}`));
        }, PROCESSING_TIMEOUT);
        timeout.unref();

        // Whether processed or failed, resolve this promise.
        handleError
          .then(resolve, resolve)
          .done(()=> clearTimeout(timeout));
      });

      // Regardless of outcome, go on to process next job.
      withTimeout.done(nextJob, nextJob);
    }

    this._notify.debug('Waiting for jobs on queue %s', this.name);
    nextJob();
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

    this._notify.info('Processing queued job %s:%s', this.name, jobID);
    this._notify.debug('Payload for job %s:%s:', this.name, jobID, payload);

    const handlers = this._handlers.slice();
    function nextHandler() {
      const handler = handlers.shift();
      if (handler)
        return runJob(jobID, handler, [payload], PROCESSING_TIMEOUT).then(nextHandler);
    }

    return nextHandler()
      .then(()=> {
        this._notify.info('Completed queued job %s:%s', this.name, jobID);
        // Remove job from queue, swallow error
        return session.request('destroy', jobID)
          .catch(()=> this._notify.info('Could not delete job %s:%s', this.name, jobID) );
      })
      .catch((error)=> {
        // Ideally an error and we want to log the full stack trace, but promise
        // may reject false, undefined, etc.
        this._notify.error('Error processing queued job %s:%s', this.name, jobID, error);
        // Error or timeout: we release the job back to the queue.  Since this
        // may be a transient error condition (e.g. server down), we let it sit
        // in the queue for a while before it becomes available again.
        const priority = 0;
        const delay = ifProduction(RELEASE_DELAY);
        session.request('release', jobID, priority, msToSec(delay));
        throw error;
      });
  }

  // Delete all messages from the queue.
  purgeQueues() {
    // Kill any sessions blocking to reserve a job.
    for (let reserve of this._reserveSessions)
      reserve.end();

    // We're using the _put session (use), the _reserve session (watch) doesn't
    // return any jobs.
    const session = this._put;

    // Ignore NOT_FOUND, we get that if there is no job in the queue.
    function onError(error) {
      if (error != 'NOT_FOUND')
        throw error;
    }

    // Delete all ready jobs.
    function deleteReadyJob() {
      return session.request('peek_ready')
        .then(([jobID])=> session.request('destroy', jobID) )
        .then(deleteReadyJob)
        .catch(onError);
    }

    // Delete all delayed jobs.
    function deleteDelayedJob() {
      return session.request('peek_delayed')
        .then(([jobID])=> session.request('destroy', jobID) )
        .then(deleteDelayedJob)
        .catch(onError);
    }

    return Promise.all([ deleteReadyJob(), deleteDelayedJob() ]);
  }


  // Session for storing messages and other manipulations, created lazily
  get _put() {
    let session = this._putSession;
    if (!session) {
      // Setup: tell Beanstalkd which tube to use (persistent to session).
      const tubeName = this._prefixedName;
      session = new Session(this._server, `${this.name}/put`, function(client, callback) {
        client.use(tubeName, callback);
      });
      this._putSession = session;
    }
    return session;
  }

  // Session for processing messages, created lazily.  This sessions is
  // blocked, so all other operations should happen on the _put session.
  _reserve(index) {
    let session = this._reserveSessions[index];
    if (!session) {
      // Setup: tell Beanstalkd which tube we're watching (and ignore default tube).
      const tubeName = this._prefixedName;
      session = new Session(this._server, `${this.name}/${index}`, function(client, callback) {
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


Queue.prototype.push = deprecate(function() {
  return this.pushJob.apply(this, arguments);
}, 'push is deprecated, please use pushJob instead');

Queue.prototype.delay = deprecate(function() {
  return this.delayJob.apply(this, arguments);
}, 'delay is deprecated, please use delayJob instead');

Queue.prototype.each = deprecate(function() {
  return this.eachJob.apply(this, arguments);
}, 'each is deprecated, please use eachJob instead');


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
    assert(name, 'Missing queue name');
    let queue = this._queues[name];
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
    this.notify.debug('Start all queues');
    this.started = true;
    for (let queue of this.queues)
      queue.start();
  }

  // Stops processing jobs from all queues.
  stop() {
    this.notify.debug('Stop all queues');
    this.started = false;
    for (let queue of this.queues)
      queue.stop();
  }

  // Use when testing to empty contents of all queues.  Returns a promise.
  purgeQueues() {
    this.notify.debug('Clear all queues');
    const promises = this.queues.map((queue)=> queue.purgeQueues());
    return Promise.all(promises);
  }

  // Use when testing to wait for all jobs to be processed.  Returns a promise.
  runOnce() {
    const onces = this.queues.map((queue)=> queue.runOnce());
    return Promise
      .all(onces)
      .then((processed)=> {
        const anyProcessed = (processed.indexOf(true) >= 0);
        if (anyProcessed)
          return this.runOnce();
      });
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

