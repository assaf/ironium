'use strict';
const assert        = require('assert');
const Beanstalk     = require('./beanstalk');
const Bluebird      = require('bluebird');
const debug         = require('debug')('queues');
const Domain        = require('domain');
const EventEmitter  = require('events');
const ms            = require('ms');
const hrTime        = require('pretty-hrtime');
const ironMQ         = require('iron_mq');
const runJob        = require('./run_job');
const Stream        = require('stream');


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


// Returns actual timeout in production.  If NODE_ENV is development or test,
// return a timeout no larger than the limit (default to zero).
function ifProduction(timeout, limit) {
  limit = limit || 0;
  return (/^(development|test)$/.test(process.env.NODE_ENV)) ?  Math.min(limit, timeout) : timeout;
}

// Convert milliseconds (JS time) to seconds (Beanstalk time).
function msToSec(ms) {
  return Math.round(ms / 1000);
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
    this.name         = name;

    this._server      = server;

    this._processing  = false;
    this._handlers    = [];

    // Used to limit concurrency for stream processing (see throttle method)
    this._queuing     = 0;
    this._concurrency = 3;

    this.configAsync  = server.configAsync;

    this.queueJob     = this.queueJob.bind(this);
    this.delayJob     = this.delayJob.bind(this);
    this.eachJob      = this.eachJob.bind(this);
    this.stream       = this.stream.bind(this);
  }


  // Queue job.  If called with one argument, returns a promise.
  queueJob(job, callback) {
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

  _delayJob(job, duration) {
    // Converts '5m' to 300 seconds.  The toString is necessary to handle
    // numbers properly, since ms(number) -> string.
    const delay   = msToSec(ms(duration.toString()));
    const body    = Buffer.isBuffer(job) ? job.toString() : JSON.stringify(job);

    ++this._queuing;
    const doneQueueing = ()=> {
      --this._queuing;
      this.emit('ready');
    };

    return this._putClientAsync.then((client)=> {
      return new Promise((resolve, reject)=> {
        client.post({ body, delay }, (error, jobID)=> {
          if (error)
            // This will typically be connection error, not helpful until we include the queue name.
            reject(new Error(`Error queuing to ${this.name}: ${error.message}`));
          else {
            debug('Queued job %s on queue %s', jobID, this.name, body);
            resolve(jobID);
          }
          setImmediate(doneQueueing);
        });
      });
    });
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
    this._handlers.push(handler);
    this._width = Math.max(isNaN(width) ? 1 : width, 1);

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
    if (this._getSessionAsync) {
      this._getSessionAsync.then(client => client.end());
      this._getSessionAsync = null;
    }
    if (this._putSessionAsync) {
      this._putSessionAsync.then(client => client.end());
      this._putSessionAsync = null;
    }
  }


  // Called to process all jobs in this queue.  Returns a promise that resolves
  // to true if any job was processed.
  runOnce() {
    return Promise.resolve().then(()=> {

      assert(!this._processing, 'Cannot call once while continuously processing jobs');
      if (!this._handlers.length)
        return false;

      debug('Waiting for jobs on queue %s', this.name);
      return this._reserveAndProcess();
    });
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


  // Used by runOnce to reserve and process each job recursively.
  _reserveAndProcess() {
    return this._getClientAsync
      .then((client)=> {

        return new Promise(function(resolve, reject) {
        const timeout = msToSec(PROCESSING_TIMEOUT);

          client.reserve({ timeout }, function(error, message) {
            if (error && /not found/i.test(error.message))
              resolve();
            else if (error)
              reject(error);
            else
              resolve(message);
          });
        })
        .then((message)=> {
          if (message) {
            const message_id       = message.id;
            const reservation_id   = message.reservation_id;
            const payload         = message.body;
            return this._runAndDestroy(client, message_id, reservation_id, payload)
              .then(()=> this._reserveAndProcess() )
              .then(()=> true); // At least one job processed, resolve to true

          } else
            return false;
        });

      });
  }


  // Calls _processContinuously for each session
  _startProcessing() {
    const width = Math.max(this._width, 1);
    this._getClientAsync.then((client)=> {
      for (let i = 0; i < width; ++i)
        this._processContinuously(client);
    });
  }

  // Called to process all jobs, until this._processing is set to false.
  _processContinuously(session) {
    const queue   = this;
    const backoff = ifProduction(RESERVE_BACKOFF);

    debug('Waiting for jobs on queue %s', this.name);
    if (!(queue._processing && queue._handlers.length))
      return;

    const timeout        = msToSec(PROCESSING_TIMEOUT);
    const processAsync   = new Promise(function(resolve) {
      session.reserve({ timeout }, function(error, message) {
        if (error && /^TIMED_OUT/.test(error.message)) {
          if (session.end)
            session.end();
          resolve();
        } else if (error)
          setTimeout(resolve, backoff);
        else if (message) {
          const message_id       = message.id;
          const reservation_id   = message.reservation_id;
          const payload         = message.body;
          const runAsync        = queue._runAndDestroy(session, message_id, reservation_id, payload);
          resolve(runAsync);
        } else
          resolve();
      });
    });
    processAsync
      .then(()=> this._processContinuously(session) )
      .catch(()=> this._processContinuously(session) );
  }


  // Called to process a job.  If successful, deletes job, otherwise returns job
  // to queue.  Returns a promise.
  _runAndDestroy(client, message_id, reservation_id, payload) {
    const jobID = message_id;

    try {
      // Payload comes in the form of a buffer, need to convert to a string.
      payload = payload.toString();
      // Typically we queue JSON objects, but the payload may be just a
      // string, e.g. some services send URL encoded name/value pairs, or MIME
      // messages.
      payload = JSON.parse(payload);
    } catch(ex) {
      // intentionally left empty
    }

    const start   = process.hrtime();
    return Promise.resolve()
      .then(()=> {
        debug('Processing queued job %s:%s', this.name, jobID, payload);

        const working = this._handlers
          .map(handler => runJob(jobID, handler, [payload], PROCESSING_TIMEOUT));
        return Promise.all(working);
      })
      .then(()=> {
        const elapsed = hrTime(process.hrtime(start));
        debug('Completed queued job %s:%s in %s', this.name, jobID, elapsed);
      })
      .catch((error)=> {
        this._server._ironium.reportError(`${this.name}#${jobID}`, error);

        // Error or timeout: we release the job back to the queue.  Since this
        // may be a transient error condition (e.g. server down), we let it sit
        // in the queue for a while before it becomes available again.
        const delay = msToSec(ifProduction(RELEASE_DELAY));

        const releaseAsync = new Promise((resolve)=> {
          client.msg_release(message_id, reservation_id, { delay }, (releaseError)=> {
            if (releaseError)
              debug('Could not release job %s:%s', this.name, jobID, releaseError);
            resolve();
          });
        });

        const reportAsync = releaseAsync
          .then(()=> {
            // Use domain to pass jobID to error handler for logging, etc
            const domain = Domain.createDomain();
            domain.jobID = jobID;
            domain.run(()=> {
              debug('Error processing queued job %s:%s', this.name, jobID, error);
            });
          });

        return reportAsync
          .then(function() {
            throw error;
          });
      })
      .then(()=> {
        return new Promise((resolve)=> {
          client.del(message_id, { reservation_id }, (deleteError)=> {
            // Remove job from queue: there's nothing we can do about an error here
            if (deleteError)
              debug('Could not delete job %s:%s', this.name, jobID, deleteError);
            resolve();
          });
        });
      });
  }


  // Delete all messages from the queue.
  purgeQueue() {
    this.stop();

    // We're using the _putClient session (use), the _reserve session (watch) doesn't
    // return any jobs.
    return this._putClientAsync.then(peekAndDelete);

    function peekAndDelete(client) {
      return new Promise(function(resolve, reject) {
        client.peek({ n: 100 }, function(error, ids) {
          if (error && /not found/i.test(error))
            resolve();
          else if (error)
            reject(error);
          else if (ids.length) {
            const deleteAll = Promise.all(ids.map(id => deleteAsync(client, id)));
            const andRepeat = deleteAll.then(()=> peekAndDelete(client));
            resolve(andRepeat);
          } else
            resolve();
        });
      });
    }

    function deleteAsync(client, message_id) {
      return new Promise(function(resolve, reject) {
        client.del(message_id, {}, function(error) {
          if (error)
            reject(error);
          else
            resolve();
        });
      });
    }

  }


  // Resolves to session for storing messages and other manipulations.
  get _putClientAsync() {
    if (!this._putSessionAsync)
      this._putSessionAsync = this.configAsync
        .then((config)=> {
          if (config.isBeanstalk) {

            const tubeName = config.prefixedName(this.name);
            return new Beanstalk(config, `${this.name}/put`, function setupSession(client) {
              // Setup: tell Beanstalkd which tube to use (persistent to session).
              // Allows the process to exit when done processing, otherwise, it will
              // stay running while it's waiting to reserve the next job.
              client.stream.unref();
              return Bluebird.promisify(client.use.bind(client))(tubeName);
            });

          }
          else
            return this._ironMQAsync;
        });
    return this._putSessionAsync;
  }


  // Resolves to session for processing messages. These sessions are blocked,
  // so all other operations should happen on the put session.
  get _getClientAsync() {
    if (!this._getSessionAsync)
      this._getSessionAsync = this.configAsync
        .then((config)=> {
          if (config.isBeanstalk) {

            const tubeName = config.prefixedName(this.name);
            return new Beanstalk(config, `${this.name}/get`, function setupSession(client) {
              // Setup: tell Beanstalkd which tube we're watching (and ignore default tube).
              // Must watch a new tube before we can ignore default tube
              const watchPromise   = Bluebird.promisify(client.watch.bind(client))(tubeName);
              const ignorePromise = Bluebird.promisify(client.ignore.bind(client))('default');
              return Promise.all([watchPromise, ignorePromise]);
            });

          }
          else
            return this._ironMQAsync;
        });
    return this._getSessionAsync;

  }


  // Resolves to an IronMQ Client object.
  get _ironMQAsync() {
    if (!this._ironMQPromise)
      this._ironMQPromise = this.configAsync
        .then((config)=> {
          const ironMQConfig = {
            project_id: config.project_id,
            token:      config.token,
            host:       config.host,
            queue_name: config.prefixedName(this.name)
          };
          return new ironMQ.Client(ironMQConfig);
        });
    return this._ironMQPromise;
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
    debug('Start all queues');
    this.started = true;
    for (let queue of this.queues)
      queue.start();
  }

  // Stops processing jobs from all queues.
  stop() {
    debug('Stop all queues');
    this.started = false;
    for (let queue of this.queues)
      queue.stop();
  }

  // Use when testing to empty contents of all queues.  Returns a promise.
  purgeQueues() {
    debug('Clear all queues');
    const promises = this.queues.map(queue => queue.purgeQueue());
    return Promise.all(promises).then(()=> undefined);
  }

  // Use when testing to wait for all jobs to be processed.  Returns a promise.
  runOnce() {
    const promises     = this.queues.map(queue => queue.runOnce());
    const awaitAll     = Promise.all(promises);
    const maybeRepeat = awaitAll
      .then((processed)=> {
        const anyProcessed  = (processed.indexOf(true) >= 0);
        if (anyProcessed)
          return this.runOnce();
      });
    return maybeRepeat;
  }

  // Returns an array of all queues.
  get queues() {
    return Object.keys(this._queues).map(name => this._queues[name]);
  }

  // Resolves to Configuration object.
  get configAsync() {
    // Lazy load configuration.
    return this._ironium.configAsync;
  }
};

