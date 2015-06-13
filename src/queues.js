const assert            = require('assert');
const Bluebird          = require('bluebird');
const { EventEmitter }  = require('events');
const Fivebeans         = require('fivebeans');
const ms                = require('ms');
const hrTime            = require('pretty-hrtime');
const Promise           = require('bluebird');
const runJob            = require('./run_job');
const Stream            = require('stream');


// How long to wait establishing a new connection.
const CONNECT_TIMEOUT       = ms('5s');

// How long to wait when reserving a job.  Iron.io closes connection if we wait
// too long.
const RESERVE_TIMEOUT       = ms('30s');

// Back-off in case of connection error, prevents continuously failing to
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

    this._connectPromise = null;
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
  async request(command, ...args) {
    // Ask for connection, we get a promise that resolves into a client.
    // We return a new promise that resolves to the output of the request.
    const client  = await this.connect();
    const promise = new Promise((resolve, reject)=> {
      // Processing (continuously or not) know to ignore the TIMED_OUT
      // and CLOSED errors.

      // When Fivebeans client executes a command, it doesn't monitor for
      // connection close/error, so we need to catch these events ourselves
      // and reject the promise.
      const onConnectionEnded = (error)=> {
        reject(error);
        this._notify.debug('%s: %s => %s', this.id, command, error);
      }

      client.once('close', onConnectionEnded);
      client.once('error', onConnectionEnded);

      this._notify.debug('%s: $ %s', this.id, command, ...args);
      client[command].call(client, ...args, (error, ...results)=> {
        // This may never get called
        client.removeListener('close', onConnectionEnded);
        client.removeListener('error', onConnectionEnded);

        if (error) {
          this._notify.debug('%s: %s => !%s', this.id, command, error);
          reject(error);
        } else if (results.length > 1) {
          this._notify.debug('%s: %s => %s', this.id, command, results);
          resolve(results);
        } else {
          this._notify.debug('%s: %s => %s', this.id, command, results[0]);
          resolve(results[0]);
        }
      });

    });
    const response = await promise;
    return response;
  }

  // Called to establish a new connection, or use existing connections.
  // Resolves to a FiveBeans client.
  async connect() {
    // This may be called multiple times, we only want to establish the
    // connection once, so we reuse the same promise
    if (this._connectPromise)
      return await this._connectPromise;

    const _connectPromise = this._connect(()=> {
      // If client connection closed/end, discard the promise
      if (this._connectPromise === _connectPromise)
        this._connectPromise = null;
    });
    this._connectPromise = _connectPromise;

    try {
      return await _connectPromise;
    } catch (error) {
      // If connection errors, discard the promise
      if (this._connectPromise === _connectPromise)
        this._connectPromise = null;
      throw error;
    }
  }

  async _connect(onClosed) {
    // This is the Fivebeans client is essentially a session.
    const config  = this._config;
    const client  = new Fivebeans.client(config.queues.hostname, config.queues.port);
    // For when we have a lot of writers contending to push to the same queue.
    client.setMaxListeners(0);

    // Once we established a connection, need to monitor for errors of when
    // server decides to close it
    client.once('error', (error)=> {
      onClosed();
      this._notify.debug('Client error in queue %s: %s', this.id, error.toString());
    });

    // This promise resolves when client connects.
    const establishConnection = new Promise(function(resolve, reject) {
      // Nothing happens until we start the connection.  Must wait for
      // connection event before we can send anything down the stream.
      client.connect();

      client.on('connect', resolve);
      client.on('error', reject);
      client.on('close', function() {
        reject(new Error('CLOSED'));
      });
    });
    // Make sure we timeout on slow connections, and try again
    await Bluebird.resolve(establishConnection).timeout(CONNECT_TIMEOUT);

    // Watch for end and switch to new session
    client.stream.once('end', ()=> {
      onClosed();
      this._notify.debug('Connection closed for %s', this.id);
    });

    // When working with Iron.io, need to authenticate each connection before
    // it can be used.  This is the first setup step, followed by the
    // session-specific setup.
    if (config.authenticate)
      await Bluebird.promisify(client.put, client)(0, 0, 0, config.authenticate);

    // Put/reserve clients have different setup requirements, this are handled by
    // an externally supplied method.
    await this.setup(client);

    return client;
  }

  // Close this session
  end() {
    if (this._connectPromise) {
      this._connectPromise
        .then(client => client.end())
        .catch(()=> null);
      this._connectPromise = null;
    }
  }

}


// Stream transform: writeable stream that accepts jobs, and readable strem that
// provides their job IDs, after queuing.
//
// This stream will terminate on the first error.
//
// This stream throttles its input based on the queuing bandwidth.
class QueuingTransform extends Stream.Transform {

  constructor(queue) {
    super();
    // Allow queuing objects
    this._writableState.objectMode = true;
    this._readableState.objectMode = true;
    // No bufferring. This is intentional, we want to throttle stream processing
    // to queuing bandwidth.
    this._writableState.highWaterMark = 0;
    this._readableState.highWaterMark = 0;

    this._queue     = queue;
    // Stop stream when we encounter an error
    this._lastError = null;
    // Count how many jobs we're queuing but still waiting for confirmation and
    // job ID.  We're not done processing until this goes back to zero.
    this._queuing   = 0;
  }

  _transform(job, encoding, callback) {
    // We throttle stream processing based on our queuing bandwidth.  We can
    // push as many jobs as we want to queueJob, they will just get bufferred in
    // memory.  Instead, we ask the queue to throttle us, by calling the
    // throttle() callback when it's ready to take on the next job.
    this._queue.throttle(()=> {

      // Since we operate asynchronously, we can only react to the previous
      // error
      if (!this._lastError) {

        // Reference counting so we don't finish this transform until we're done
        // queuing all the jobs (see _flush).
        ++this._queuing;

        this._queue.queueJob(job, (error, jobID)=> {
          // If there's an error, next _transform or _flush will find it
          if (error)
            this._lastError = error;
          else
            this.push(jobID);

          // Once we've queued all jobs, emit the drain event so _flush can
          // complete
          --this._queuing;
          if (this._queuing === 0)
            this.emit('drain');
        });

      }

      // Let the next job in, so we're running multiple queueJob in parallel,
      // but no more than concurrently allowed by throttle.
      //
      // Or stop processing if we hit an error in previous _transform.
      callback(this._lastError);
    });
  }

  _flush(callback) {
    // There are no more jobs coming on the writeable end, but we're not done
    // with the readable end of things until we queued all the jobs,
    if (this._queuing === 0)
      callback(this._lastError);
    else
      this.once('drain', callback);
  }
}


// Abstraction for a queue.  Has two sessions, one for pushing messages, one
// for processing them.
class Queue extends EventEmitter {

  constructor(server, name) {
    super();
    this.name             = name;
    this.webhookURL       = server.config.webhookURL(name);

    this._server          = server;
    this._notify          = server.notify;
    this._prefixedName    = server.config.prefixedName(name);

    this._processing      = false;
    this._handlers        = [];
    this._putSession      = null;
    this._reserveSessions = [];

    // Used to limit concurrency for stream processing (see throttle method)
    this._queuing         = 0;
    this._concurrency     = 3;

    this._config          = server.config.queues;
    this._width           = server.config.width || 1;

    this.queueJob         = this.queueJob.bind(this);
    this.delayJob         = this.delayJob.bind(this);
    this.eachJob          = this.eachJob.bind(this);
    this.stream           = this.stream.bind(this);
  }


  // Queue job.  If called with one argument, returns a promise.
  queueJob(job, callback) {
    return this.delayJob(job, 0, callback);
  }

  // Push job to queue.  If called with one argument, returns a promise.
  pushJob(job, callback) {
    return this.delayJob(job, 0, callback);
  }

  // Push job to queue with the given delay.  Delay can be millisecond,
  // or a string of the form '5s', '2m', etc.  If called with two arguments,
  // returns a promise.
  delayJob(job, duration, callback) {
    assert(job != null, 'Missing job to queue');
    assert(duration.toString, 'Delay must be string or number');

    const promise = this._delayJob(job, duration);
    if (callback)
      promise.then((jobID)=> callback(null, jobID), callback);
    else
      return promise;
  }

  async _delayJob(job, duration) {
    const priority  = 0;
    // Converts '5m' to 300 seconds.  The toString is necessary to handle
    // numbers properly, since ms(number) -> string.
    const delay     = msToSec( ifProduction( ms(duration.toString()), this._config.maxDelay || 0 ) );
    const timeToRun = msToSec(PROCESSING_TIMEOUT);
    const payload   = Buffer.isBuffer(job) ? job : JSON.stringify(job);

    ++this._queuing;
    try {
      const jobID = await this._put.request('put', priority, delay, timeToRun, payload)
      this._notify.debug('Queued job %s on queue %s', jobID, this.name, payload);
      return jobID;
    } catch (error) {
      // This will typically be connection error, not helpful until we include the queue name.
      throw new Error(`Error queuing to ${this.name}: ${error.message}`);
    } finally {
      --this._queuing;
      this.emit('ready');
    }
  }

  // Returns a stream transform for queueing jobs.  This is a duplex stream, for
  // each job you write to the stream, you can read one job ID of the queued
  // job.
  stream() {
    return new QueuingTransform(this);
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
      this._startProcessing();
  }


  // Start processing jobs.
  start() {
    // Don't act stupid if called multiple times.
    if (this._processing)
      return;
    this._processing = true;

    // Only call _processContinuously if there are any handlers associated with
    // this queue.  A queue may have no handle (e.g. one process queues,
    // another processes), in which case we don't want to listen on it.
    if (this._handlers.length)
      this._startProcessing();
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


  // Called to process all jobs in this queue.  Returns a promise that resolves
  // to true if any job was processed.
  async runOnce() {
    assert(!this._processing, 'Cannot call once while continuously processing jobs');
    if (!this._handlers.length)
      return false;

    this._notify.debug('Waiting for jobs on queue %s', this.name);
    return await this._reserveAndProcess();
  }


  // For stream processing, we want to throttle the stream based on our queuing
  // bandwidth.  The callback is called when it's good time to queue the next
  // job.
  //
  // We do allow some jobs to be queued in parallel, we don't need to wait for
  // one job to be queued before sending the next one.  But we limit it to a
  // reasonable number, since queueJob will take any number of jobs you throw at
  // it, and simply buffer them all in memory.
  //
  // At the moment _concurrency is derived from Works On My Machine(tm).
  throttle(callback) {
    if (this._queuing < this._concurrency)
      callback();
    else
      this.once('ready', ()=> this.throttle(callback));
  }


  // Used by once to reserve and process each job recursively.
  async _reserveAndProcess() {
    try {

      const timeout           = 0;
      const session           = await this._reserve(0);
      const [jobID, payload]  = await session.request('reserve_with_timeout', timeout);
      await this._runAndDestroy(session, jobID, payload);
      await this._reserveAndProcess();
      return true;  // At least one job processed, resolve to true

    } catch (error) {

      const reason = error.message || error;
      if (/^(TIMED_OUT|CLOSED|DRAINING)$/.test(reason))
        return false; // Job not processed
      else
        throw error;

    }
  }


  // Calls _processContinuously for each session
  async _startProcessing() {
    for (let i = 0; i < this._width; ++i) {
      let session = await this._reserve(i);
      this._processContinuously(session);
    }
  }

  // Called to process all jobs, until this._processing is set to false.
  async _processContinuously(session) {
    const queue   = this;
    const backoff = ifProduction(RESERVE_BACKOFF);

    this._notify.debug('Waiting for jobs on queue %s', this.name);
    if (!(queue._processing && queue._handlers.length))
      return;

    try {
      const [jobID, payload]  = await session.request('reserve_with_timeout', msToSec(RESERVE_TIMEOUT));

      try {
        await queue._runAndDestroy(session, jobID, payload);
      } catch (error) {
        this._notify.error('Error processing queued job %s:%s', this.name, jobID, error);
        await Bluebird.delay(backoff);
      }

    } catch (error) {
      const reason = error.message || error;
      if (/^TIMED_OUT/.test(reason))
        session.end();
    } finally {
      this._processContinuously(session);
    }
  }


  // Called to process a job.  If successful, deletes job, otherwise returns job
  // to queue.  Returns a promise.
  async _runAndDestroy(session, jobID, payload) {
    // Payload comes in the form of a buffer, need to conver to a string.
    payload = payload.toString();
    // Typically we queue JSON objects, but the payload may be just a
    // string, e.g. some services send URL encoded name/value pairs, or MIME
    // messages.
    try {
      payload = JSON.parse(payload);
    } catch(ex) {
    }

    try {

      this._notify.info('Processing queued job %s:%s', this.name, jobID);
      this._notify.debug('Payload for job %s:%s:', this.name, jobID, payload);

      const start = process.hrtime();
      const working = this._handlers
        .map(handler => runJob(jobID, handler, [payload], PROCESSING_TIMEOUT));
      await Promise.all(working);
      const elapsed = hrTime(process.hrtime(start));
      this._notify.info('Completed queued job %s:%s in %s', this.name, jobID, elapsed);

    } catch (error) {

      // Error or timeout: we release the job back to the queue.  Since this
      // may be a transient error condition (e.g. server down), we let it sit
      // in the queue for a while before it becomes available again.
      const priority  = 0;
      const delay     = ifProduction(RELEASE_DELAY);
      await session.request('release', jobID, priority, msToSec(delay));
      throw error;
    }

    // Remove job from queue: there's nothing we can do about an error here
    try {
      await session.request('destroy', jobID);
    } catch (error) {
      this._notify.info('Could not delete job %s:%s', this.name, jobID);
    }
  }


  // Delete all messages from the queue.
  async purgeQueue() {
    this.stop();

    // We're using the _put session (use), the _reserve session (watch) doesn't
    // return any jobs.
    const session = this._put;

    // Delete all ready jobs.
    try {
      while (true) {
        let [readyJobID] = await session.request('peek_ready');
        await session.request('destroy', readyJobID);
      }
    } catch (error) {
      // Ignore NOT_FOUND, we get that if there is no job in the queue.
      if (error != 'NOT_FOUND')
        throw error;
    }

    // Delete all delayed jobs.
    try {
      while (true) {
        let [delayedJobID] = await session.request('peek_delayed');
        await session.request('destroy', delayedJobID);
      }
    } catch (error) {
      // Ignore NOT_FOUND, we get that if there is no job in the queue.
      if (error != 'NOT_FOUND')
        throw error;
    }
  }


  // Session for storing messages and other manipulations, created lazily
  get _put() {
    if (!this._putSession) {

      // Setup: tell Beanstalkd which tube to use (persistent to session).
      const tubeName  = this._prefixedName;
      const session   = new Session(this._server, `${this.name}/put`, async function(client) {
        await Bluebird.promisify(client.use, client)(tubeName);
        // Allows the process to exit when done processing, otherwise, it will
        // stay running while it's waiting to reserve the next job.
        client.stream.unref();
      });

      this._putSession = session;
    }
    return this._putSession;
  }


  // Session for processing messages, created lazily.  This sessions is
  // blocked, so all other operations should happen on the _put session.
  _reserve(index) {
    if (!this._reserveSessions[index]) {

      // Setup: tell Beanstalkd which tube we're watching (and ignore default tube).
      const tubeName  = this._prefixedName;
      const session   = new Session(this._server, `${this.name}/${index}`, async function(client) {
        // Must watch a new tube before we can ignore default tube
        await Bluebird.promisify(client.watch, client)(tubeName);
        await Bluebird.promisify(client.ignore, client)('default');
      });

      this._reserveSessions[index] = session;
    }
    return this._reserveSessions[index];
  }

}


// Abstracts the queue server.
module.exports = class Queues {

  constructor(ironium) {
    // We need this to automatically start any queue added after ironium.start().
    this.started  = false;

    this._ironium = ironium;
    this._queues  = {};
  }

  // Returns the named queue, queue created on demand.
  getQueue(name) {
    assert(name, 'Missing queue name');
    if (!this._queues.hasOwnProperty(name)) {
      const queue = new Queue(this, name);
      if (this.started)
        queue.start();
      this._queues[name] = queue;
    }
    return this._queues[name];
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
  async purgeQueues() {
    this.notify.debug('Clear all queues');
    const promises = this.queues.map(queue => queue.purgeQueue());
    await Promise.all(promises);
  }

  // Use when testing to wait for all jobs to be processed.  Returns a promise.
  async runOnce() {
    const promises      = this.queues.map(queue => queue.runOnce());
    const processed     = await Promise.all(promises);
    const anyProcessed  = (processed.indexOf(true) >= 0);
    if (anyProcessed)
      await this.runOnce();
  }

  // Returns an array of all queues.
  get queues() {
    return Object.keys(this._queues).map(name => this._queues[name]);
  }

  get config() {
    // Lazy load configuration.
    return this._ironium.config;
  }

  get notify() {
    return this._ironium;
  }
};

