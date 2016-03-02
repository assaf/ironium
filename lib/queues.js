'use strict';
const assert        = require('assert');
const Beanstalk     = require('./beanstalk');
const Bluebird      = require('bluebird');
const debug         = require('debug')('ironium:queues');
const Domain        = require('domain');
const EventEmitter  = require('events');
const ms            = require('ms');
const hrTime        = require('pretty-hrtime');
const ironMQ        = require('iron_mq');
const runJob        = require('./run_job');
const Stream        = require('stream');


// Back-off in case of connection error, prevents continuously failing to
// reserve a job.
const RESERVE_BACKOFF     = ms('30s');

// Timeout for processing job before we consider it failed and release it back
// to the queue.
const PROCESSING_TIMEOUT  = ms('10m');

// Delay before a released job is available for pickup again. This is our
// primary mechanism for dealing with load during failures. Ignored in test
// environment.
const RELEASE_DELAY       = ms('1m');

// How long to wait when reserving a job (1 minute seems to be the maximum).
const RESERVE_WAIT        = ms('1m');


// Returns actual timeout in production.  If NODE_ENV is development or test,
// return a timeout no larger than the limit (default to zero).
function ifProduction(timeout, limit) {
  return (/^(development|test)$/.test(process.env.NODE_ENV)) ?
    Math.min(limit || 0, timeout) :
    timeout;
}

// Convert milliseconds (JS time) to seconds (Beanstalk time).
function msToSec(milliseconds) {
  return Math.round(milliseconds / 1000);
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
    this._queue._throttle(() => {
      // Since we operate asynchronously, we can only react to the previous
      // error
      if (!this._lastError)
        this._queueJob(job);

      // Let the next job in, so we're running multiple queueJob in parallel,
      // but no more than concurrently allowed by throttle.
      //
      // Or stop processing if we hit an error in previous _transform.
      callback(this._lastError);
    });
  }


  _queueJob(job) {
    // Reference counting so we don't finish this transform until we're done
    // queuing all the jobs (see _flush).
    ++this._queuing;

    this._queue.queueJob(job)
      .then(jobID => {
        this.push(jobID);
      })
      .catch(error => {
        // If there's an error, next _transform or _flush will find it
        this._lastError = error;
      })
      .then(() => {
        // Once we've queued all jobs, emit the drain event so _flush can
        // complete
        --this._queuing;
        if (this._queuing === 0)
          this.emit('drain');
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
class Queue {

  constructor(server, queueName) {
    this._server      = server;
    this.name         = queueName;

    this._handlers    = new Set();
    this._processing  = false;

    // Used to limit concurrency for stream processing (see throttle method)
    this._queuing     = 0;
    this._concurrency = 3;
    this._emitter     = new EventEmitter();

    this.queueJob     = Queue.prototype.queueJob.bind(this);
    this.delayJob     = Queue.prototype.delayJob.bind(this);
    this.eachJob      = Queue.prototype.eachJob.bind(this);
    this.stream       = Queue.prototype.stream.bind(this);
  }


  // Queue job with no delay.
  queueJob(job) {
    return this.delayJob(job, 0);
  }

  // Push job to queue with the given delay.  Delay can be millisecond,
  // or a string of the form '5s', '2m', etc.
  delayJob(job, duration) {
    assert(job != null,       'Missing job to queue');
    assert(duration.toString, 'Delay must be string or number');

    // Converts '5m' to 300 seconds.  The toString is necessary to handle
    // numbers properly, since ms(number) -> string.
    const delay   = msToSec(ms(duration.toString()));
    const body    = Buffer.isBuffer(job) ? job.toString() : JSON.stringify(job);

    const queue   = this;
    ++this._queuing;
    return this._putClientPromise.then(postJob);

    function postJob(client) {
      return new Promise(function(resolve, reject) {
        client.post({ body, delay }, function(error, jobID) {
          if (error)
            // This will typically be connection error, not helpful until we include the queue name.
            reject(new Error(`Error queuing to ${queue.name}: ${error.message}`));
          else {
            debug('Queued job %s on queue %s', jobID, queue.name, body);
            resolve(jobID);
            setImmediate(decrementQueuingCount);
          }
        });
      });
    }

    function decrementQueuingCount() {
      --queue._queuing;
      queue._emitter.emit('ready');
    }
  }


  // Returns a stream transform for queueing jobs.  This is a duplex stream, for
  // each job you write to the stream, you can read one job ID of the queued
  // job.
  stream() {
    return new QueuingTransform(this);
  }


  // Process jobs from queue.
  eachJob(handler) {
    assert(typeof handler === 'function', 'Called each without a valid handler');
    if (!this._handlers.has(handler)) {
      this._handlers.add(handler);

      // It is possible start() was already called, but there was no handler, so
      // this is where we start listening.
      const firstHandler = (this._handlers.size === 1);
      if (this._processing && firstHandler)
        this._startProcessing();
    }
  }


  // Start processing jobs.
  start() {
    // Don't act stupid if called multiple times.
    if (!this._processing) {
      this._processing = true;

      // Only call _processContinuously if there are any handlers associated with
      // this queue.  A queue may have no handle (e.g. one process queues,
      // another processes), in which case we don't want to listen on it.
      const hasHandlers = (this._handlers.size > 0);
      if (hasHandlers)
        this._startProcessing();
    }
  }

  // Stop processing jobs.
  stop() {
    this._processing = false;
    this._getSessionPromise = null;
    this._putSessionPromise = null;
  }


  // Called to process all jobs in this queue.  Returns a promise that resolves
  // to true if any job was processed.
  runOnce() {
    assert(!this._processing, 'Cannot call once while continuously processing jobs');
    const hasHandlers = (this._handlers.size > 0);
    if (hasHandlers) {

      debug('Waiting for jobs on queue %s', this.name);
      return this._getClientPromise.then(client => this._reserveAndProcess(client));

    } else
      return Promise.resolve(false);
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
  _throttle(callback) {
    if (this._queuing < this._concurrency)
      callback();
    else
      this._emitter.once('ready', () => this._throttle(callback));
  }


  // Used by runOnce to reserve and process each job recursively.
  //
  // Resolves to true if any job was processed, false otherwise.
  _reserveAndProcess(client) {
    return this._reserveJob(client, 0)
      .then(job => {
        if (job) {
          return this._runAndDestroy(client, job)
            .then(() => this._reserveAndProcess(client) )
            .then(() => true); // At least one job processed, resolve to true
        } else
          return false;
      });
  }


  // Calls _processContinuously for each session
  _startProcessing() {
    const width = Math.max(isNaN(this._width) ? 1 : this._width, 1);
    this._getClientPromise
      .then(client => {
        for (let i = 0; i < width; ++i)
          this._processContinuously(client);
        return null;
      });
  }

  // Called to process all jobs, until this._processing is set to false.
  _processContinuously(client) {
    const hasHandlers = (this._handlers.size > 0);
    if (this._processing && hasHandlers) {

      debug('Waiting for jobs on queue %s', this.name);
      const backoff = ifProduction(RESERVE_BACKOFF);
      const wait    = (process.env.NODE_ENV === 'test' ? 0 : msToSec(RESERVE_WAIT));
      this._reserveJob(client, wait)
        .then(job => {
          if (this._processing)
            return this._runAndDestroy(client, job);
          else
            return releaseJob(job);
        })
        .catch(() => Bluebird.delay(backoff))
        .then(() => this._processContinuously(client));
    }
    return null;

    function releaseJob(job) {
      const jobID         = job.id;
      const reservationID = job.reservation_id;
      client.msg_release(jobID, reservationID, { delay: 0 });
    }
  }


  // _reserveAndProcess and _processContinuously use this
  _reserveJob(client, wait) {
    return new Promise(function(resolve, reject) {
      const timeout = msToSec(PROCESSING_TIMEOUT);

      client.reserve({ timeout, wait }, function(error, job) {
        if (error && /not found/i.test(error.message))
          resolve(); // IronMQ v3 API
        else if (error && /^TIMED_OUT/.test(error.message))
          resolve(); // beanstalkd API
        else if (error)
          reject(error);
        else
          resolve(job);
      });
    });
  }


  // Called to process a job.  If successful, deletes job, otherwise returns job
  // to queue.  Returns a promise.
  _runAndDestroy(client, job) {
    const jobID = job.id;
    const queue = this;
    const start = process.hrtime();

    return Promise.resolve()
      .then(runHandlers)
      .then(logProcessingTime)
      .then(deleteJob)
      .catch(releaseJob);


    function runHandlers() {
      const body = parseBody(job.body);
      debug('Processing queued job %s:%s', queue.name, jobID, body);

      const handlers = Array.from(queue._handlers);
      const promises = handlers.map(handler => runJob(jobID, handler, [body], PROCESSING_TIMEOUT));
      return Promise.all(promises);
    }

    function parseBody(body) {
      try {
        // Typically we queue JSON objects, but the payload may be just a
        // string, e.g. some services send URL encoded name/value pairs, or MIME
        // messages.
        return JSON.parse(body);
      } catch (error) {
        // Payload comes in the form of a buffer, need to convert to a string.
        return body.toString();
      }
    }

    function logProcessingTime() {
      const elapsed = hrTime(process.hrtime(start));
      debug('Completed queued job %s:%s in %s', queue.name, jobID, elapsed);
    }

    function deleteJob() {
      const reservationID = job.reservation_id;
      client.del(jobID, { reservationID }, function(deleteError) {
        // Remove job from queue: there's nothing we can do about an error here
        if (deleteError)
          debug('Could not delete job %s:%s', queue.name, jobID, deleteError);
      });
    }

    function releaseJob(error) {
      // Don't need to wait for this to complete
      const reservationID = job.reservation_id;
      // Error or timeout: we release the job back to the queue.  Since this
      // may be a transient error condition (e.g. server down), we let it sit
      // in the queue for a while before it becomes available again.
      const delay = msToSec(ifProduction(RELEASE_DELAY));

      client.msg_release(jobID, reservationID, { delay }, function(releaseError) {
        if (releaseError)
          debug('Could not release job %s:%s', queue.name, jobID, releaseError);
      });

      reportError(error);
      // Propagate out
      throw error;
    }

    function reportError(error) {
      queue._server._ironium.reportError(`${queue.name}#${jobID}`, error);

      // Use domain to pass jobID to error handler for logging, etc
      const domain = Domain.createDomain();
      domain.jobID = jobID;
      domain.run(function() {
        debug('Error processing queued job %s:%s', queue.name, jobID, error);
      });
    }

  }


  // Delete all messages from the queue.
  purgeQueue() {
    // We're using the _putClient session (use), the _reserve session (watch) doesn't
    // return any jobs.
    return this._putClientPromise.then(peekAndDelete);

    function peekAndDelete(client) {
      return new Promise(function(resolve, reject) {
        client.peek({ n: 100 }, function(error, ids) {
          if (error && /not found/i.test(error))
            resolve();
          else if (error)
            reject(error);
          else if (ids.length) {
            const deleteEach  = ids.map(id => deleteAsync(client, id));
            const deleteAll   = Promise.all(deleteEach);
            const andRepeat   = deleteAll.then(() => peekAndDelete(client));
            resolve(andRepeat);
          } else
            resolve();
        });
      });
    }

    function deleteAsync(client, jobID) {
      return new Promise(function(resolve, reject) {
        client.del(jobID, {}, function(error) {
          if (error)
            reject(error);
          else
            resolve();
        });
      });
    }
  }


  // -- Clients --

  // Resolves to session for storing messages and other manipulations.
  get _putClientPromise() {
    if (!this._putSessionPromise)
      this._putSessionPromise = this._server.configPromise.then(client => this._putClientFromConfig(client));
    return this._putSessionPromise;
  }

  // Resolves to session for processing messages. These sessions are blocked,
  // so all other operations should happen on the put session.
  get _getClientPromise() {
    if (!this._getSessionPromise)
      this._getSessionPromise = this._server.configPromise.then(client => this._getClientFromConfig(client));
    return this._getSessionPromise;
  }

  _putClientFromConfig(config) {
    if (config.isBeanstalk) {

      const tubeName = config.prefixedName(this.name);
      return new Beanstalk(config, `${this.name}/put`, function setupSession(client) {
        // Setup: tell Beanstalkd which tube to use (persistent to session).
        // Allows the process to exit when done processing, otherwise, it will
        // stay running while it's waiting to reserve the next job.
        client.stream.unref();
        const useTubePromise = Bluebird.promisify(client.use.bind(client))(tubeName);
        return useTubePromise;
      });

    } else
      return this._getIronMQFromConfig(config);
  }

  _getClientFromConfig(config) {
    if (config.isBeanstalk) {

      const tubeName = config.prefixedName(this.name);
      return new Beanstalk(config, `${this.name}/get`, function setupSession(client) {
        // Setup: tell Beanstalkd which tube we're watching (and ignore default tube).
        // Must watch a new tube before we can ignore default tube
        const watchTubePromise  = Bluebird.promisify(client.watch.bind(client))(tubeName);
        const ignoreTubePromise = Bluebird.promisify(client.ignore.bind(client))('default');
        return Promise.all([ watchTubePromise, ignoreTubePromise ]);
      });

    } else
      return this._getIronMQFromConfig(config);
  }

  _getIronMQFromConfig(config) {
    const ironMQConfig = {
      project_id: config.project_id, // eslint-disable-line camelcase
      token:      config.token,
      host:       config.host,
      queue_name: config.prefixedName(this.name) // eslint-disable-line camelcase
    };
    return new ironMQ.Client(ironMQConfig);
  }

}



// Abstracts the queue server.
module.exports = class Queues {

  constructor(ironium) {
    // We need this to automatically start any queue added after ironium.start().
    this.started  = false;

    this._ironium = ironium;
    this._queues  = new Map();
  }

  // Returns the named queue, queue created on demand.
  getQueue(queueName) {
    assert(queueName, 'Missing queue name');
    if (!this._queues.has(queueName)) {

      const queue = new Queue(this, queueName);
      if (this.started)
        queue.start();
      this._queues.set(queueName, queue);

    }
    return this._queues.get(queueName);
  }

  // Starts processing jobs from all queues.
  start() {
    debug('Start all queues');
    this.started = true;
    for (let queue of this._queues.values())
      queue.start();
  }

  // Stops processing jobs from all queues.
  stop() {
    debug('Stop all queues');
    this.started = false;
    for (let queue of this._queues.values())
      queue.stop();
  }

  // Use when testing to empty contents of all queues.  Returns a promise.
  purgeQueues() {
    debug('Clear all queues');
    const promises = this.queues.map(queue => queue.purgeQueue());
    return Promise.all(promises);
  }

  // Use when testing to wait for all jobs to be processed.  Returns a promise.
  runOnce() {
    const promises  = this.queues.map(queue => queue.runOnce());
    const awaitAll  = Promise.all(promises);
    const untilDone = awaitAll.then(processed => {
      const anyProcessed = ~processed.indexOf(true);
      if (anyProcessed)
        return this.runOnce();
      else
        return null;
    });
    return untilDone;
  }

  // Returns an array of all queues.
  get queues() {
    return Array.from(this._queues.values());
  }

  // Resolves to Configuration object.
  get configPromise() {
    // Lazy load configuration.
    return this._ironium.configPromise;
  }
};

