'use strict';
const assert        = require('assert');
const Bluebird      = require('bluebird');
const Domain        = require('domain');
const EventEmitter  = require('events');
const Fivebeans     = require('fivebeans');
const ms            = require('ms');
const hrTime        = require('pretty-hrtime');
const Promise       = require('bluebird');
const runJob        = require('./run_job');
const Stream        = require('stream');


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

// IronMQ closes connections if there's no activity on then, even when we've
// reserved a job and are in the middle of processing it.  So we're going to
// ping it every 30 seconds to force keep the connection open.
const KEEP_ALIVE            = ms('30s');


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


// Error talking to queue server, typically transient
class QueueError extends Error {

  constructor(error) {
    super();
    this.message = error.message || error;
    this.name    = error.name    || this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
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
  request(command /*, ...args */) {
		const args = Array.from(arguments).slice(1);

    // Ask for connection, we get a promise that resolves into a client.
    // We return a new promise that resolves to the output of the request.
		return this.connect()
			.then((client)=> {

				return new Promise((resolve, reject)=> {
					// Processing (continuously or not) know to ignore the TIMED_OUT
					// and CLOSED errors.

					// When Fivebeans client executes a command, it doesn't monitor for
					// connection close/error, so we need to catch these events ourselves
					// and reject the promise.
					const onConnectionEnded = (error)=> {
						reject(new QueueError(error || 'CLOSED'));
						this._notify.debug('%s: %s => %s', this.id, command, error || 'CLOSED');
					};

					client.once('close', onConnectionEnded);
					client.once('error', onConnectionEnded);

					const session = this;
					this._notify.debug('%s: $ %s %j', this.id, command, args);

					function callback(error) {
						const results = Array.from(arguments).slice(1);

						// This may never get called
						client.removeListener('close', onConnectionEnded);
						client.removeListener('error', onConnectionEnded);

						if (error) {
							session._notify.debug('%s: %s => !%s', session.id, command, args, error);
							reject(new QueueError(error));
						} else if (results.length > 1) {
							session._notify.debug('%s: %s => %s', session.id, command, results);
							resolve(results);
						} else {
							session._notify.debug('%s: %s => %s', session.id, command, results[0]);
							resolve(results[0]);
						}
					}
					client[command].apply(client, args.concat(callback));
				});

			});
  }


  // Called to establish a new connection, or use existing connections.
  // Resolves to a FiveBeans client.
  connect() {
    // This may be called multiple times, we only want to establish the
    // connection once, so we reuse the same promise
    if (this._connectPromise)
			return this._connectPromise;

		let connectPromise;

		const onClose = ()=> {
			// If client connection closed/end, discard the promise
			if (this._connectPromise === connectPromise)
				this._connectPromise = null;
		};

    connectPromise = this._connect(onClose)
			.catch((error)=> {
				onClose();
				throw new QueueError(error);
			});
    this._connectPromise = connectPromise;
		return connectPromise;
  }


  _connect(onClosed) {
		return Promise.resolve()
			.then(()=> {

				// This is the Fivebeans client is essentially a session.
				const config  = this._config;
				const client  = new Fivebeans.client(config.hostname, config.port);
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

					client.on('connect', ()=> resolve());
					client.on('error', reject);
					client.on('close', function() {
						reject(new QueueError('CLOSED'));
					});

					// Make sure we timeout on slow connections
					setTimeout(function() {
						reject(new Error('Timeout waiting for connection'));
					}, CONNECT_TIMEOUT);
				});

				return establishConnection
					.then(()=> {

						// Watch for end and switch to new session
						client.stream.once('end', ()=> {
							onClosed();
							this._notify.debug('Connection closed for %s', this.id);
						});

						// When working with Iron.io, need to authenticate each connection before
						// it can be used.  This is the first setup step, followed by the
						// session-specific setup.
						if (config.authenticate)
							return Bluebird.promisify(client.put.bind(client))(0, 0, 0, config.authenticate);
					})
					.then(()=> {
						// Put/reserve clients have different setup requirements, this are handled by
						// an externally supplied method.
						return this.setup(client);
					})
					.then(()=> client);

			});
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

    this._config          = server.config;
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
    const priority  = 0;
    // Converts '5m' to 300 seconds.  The toString is necessary to handle
    // numbers properly, since ms(number) -> string.
    const delay     = msToSec( ifProduction( ms(duration.toString()), this._config.maxDelay || 0 ) );
    const timeToRun = msToSec(PROCESSING_TIMEOUT);
    const payload   = Buffer.isBuffer(job) ? job : JSON.stringify(job);

    ++this._queuing;
		const doneQueueing = ()=> {
			--this._queuing;
			this.emit('ready');
		};

		return this._put.request('put', priority, delay, timeToRun, payload)
			.then((jobID)=> {
				setImmediate(doneQueueing);
				this._notify.debug('Queued job %s on queue %s', jobID, this.name, payload);
				return jobID;
			})
			.catch((error)=> {
				setImmediate(doneQueueing);
				// This will typically be connection error, not helpful until we include the queue name.
				throw new Error(`Error queuing to ${this.name}: ${error.message}`);
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
  runOnce() {
		return Promise.resolve().then(()=> {

			assert(!this._processing, 'Cannot call once while continuously processing jobs');
			if (!this._handlers.length)
				return false;

			this._notify.debug('Waiting for jobs on queue %s', this.name);
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
		const session = this._reserve(0);
		const timeout = 0;
		return session.request('reserve_with_timeout', timeout)
			.then((result)=> {
				const jobID 	=	result[0];
				const payload = result[1];
				return this._runAndDestroy(session, jobID, payload);
			})
			.then(()=> this._reserveAndProcess() )
			.then(()=> true) // At least one job processed, resolve to true
			.catch((error)=> {
				if (!(error instanceof QueueError))
					throw error;
				return false;
			});
  }


  // Calls _processContinuously for each session
  _startProcessing() {
    for (let i = 0; i < this._width; ++i) {
			let session = this._reserve(i);
			this._processContinuously(session);
		}
  }

  // Called to process all jobs, until this._processing is set to false.
  _processContinuously(session) {
    const queue   = this;
    const backoff = ifProduction(RESERVE_BACKOFF);

    this._notify.debug('Waiting for jobs on queue %s', this.name);
    if (!(queue._processing && queue._handlers.length))
      return;

		session.request('reserve_with_timeout', msToSec(RESERVE_TIMEOUT))
			.then(function(result) {
				const jobID 	=	result[0];
				const payload = result[1];
				return queue._runAndDestroy(session, jobID, payload);
			})
			.catch(function(error) {
				if (/^TIMED_OUT/.test(error.message))
					session.end();
				else
          return Bluebird.delay(backoff);
			})
			.then(()=> {
				this._processContinuously(session);
			});
  }


  // Called to process a job.  If successful, deletes job, otherwise returns job
  // to queue.  Returns a promise.
  _runAndDestroy(session, jobID, payload) {
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

    const keepAlive = ifProduction(KEEP_ALIVE, ms('1s'));
    const keepAliveInterval = setInterval(()=> {
      session.request('list_tubes_watched').catch(this._notify.debug);
    }, keepAlive);

		const start 	= process.hrtime();
		return Promise.resolve()
			.then(()=> {
				this._notify.info('Processing queued job %s:%s', this.name, jobID);
				this._notify.debug('Payload for job %s:%s:', this.name, jobID, payload);

				const working = this._handlers
					.map(handler => runJob(jobID, handler, [payload], PROCESSING_TIMEOUT));
				return Promise.all(working);
			})
			.then(()=> {
				const elapsed = hrTime(process.hrtime(start));
				this._notify.info('Completed queued job %s:%s in %s', this.name, jobID, elapsed);
			})
			.catch((error)=> {
				clearInterval(keepAliveInterval);

				// Error or timeout: we release the job back to the queue.  Since this
				// may be a transient error condition (e.g. server down), we let it sit
				// in the queue for a while before it becomes available again.
				const priority  = 0;
				const delay     = ifProduction(RELEASE_DELAY);
				return session.request('release', jobID, priority, msToSec(delay))
					.catch((releaseError)=> {
						this._notify.info('Could not release job %s:%s', this.name, jobID, releaseError);
					})
					.then(()=> {
						// Use domain to pass jobID to error handler for logging, etc
						const domain = Domain.createDomain();
						domain.jobID = jobID;
						domain.run(()=> {
							this._notify.error('Error processing queued job %s:%s', this.name, jobID, error);
						});
					})
					.then(function() {
						throw error;
					});
			})
			.then(()=> {
				clearInterval(keepAliveInterval);

				// Remove job from queue: there's nothing we can do about an error here
				return session.request('destroy', jobID)
					.catch((destroyError)=> {
						this._notify.info('Could not delete job %s:%s', this.name, jobID, destroyError);
					});
			});
  }


  // Delete all messages from the queue.
  purgeQueue() {
    this.stop();

    // We're using the _put session (use), the _reserve session (watch) doesn't
    // return any jobs.
    const session = this._put;

    // Delete all ready jobs.
		function removeReadyAsync() {
			return session.request('peek_ready')
				.then(function(result) {
					const readyJobID = result[0];
					return session.request('destroy', readyJobID);
				})
				.then(removeReadyAsync)
				.catch(function(error) {
					const actualError = (error.message !== 'NOT_FOUND');
					// Ignore NOT_FOUND, we get that if there is no job in the queue.
					if (actualError)
						throw error;
				});
		}

    // Delete all delayed jobs.
		function removeDelayedAsync() {
			return session.request('peek_delayed')
				.then(function(result) {
					const delayedJobID = result[0];
					return session.request('destroy', delayedJobID);
				})
				.then(removeDelayedAsync)
				.catch(function(error) {
					const actualError = (error.message !== 'NOT_FOUND');
					// Ignore NOT_FOUND, we get that if there is no job in the queue.
					if (actualError)
						throw error;
				});
		}

		return Promise.all([ removeReadyAsync(), removeDelayedAsync() ]);
  }


  // Session for storing messages and other manipulations, created lazily
  get _put() {
		const tubeName  = this._prefixedName;
    if (!this._putSession) {
      // Setup: tell Beanstalkd which tube to use (persistent to session).
      const session   = new Session(this._server, `${this.name}/put`, setupSession);
      this._putSession = session;
    }
    return this._putSession;

		function setupSession(client) {
			// Allows the process to exit when done processing, otherwise, it will
			// stay running while it's waiting to reserve the next job.
			client.stream.unref();
			return Bluebird.promisify(client.use.bind(client))(tubeName);
		}
  }


  // Session for processing messages, created lazily.  These sessions are
  // blocked, so all other operations should happen on the _put session.
  _reserve(index) {
		const tubeName  = this._prefixedName;
    if (!this._reserveSessions[index]) {
      // Setup: tell Beanstalkd which tube we're watching (and ignore default tube).
      const session   = new Session(this._server, `${this.name}/${index}`, setupSession);
      this._reserveSessions[index] = session;
    }
    return this._reserveSessions[index];

		function setupSession(client) {
			// Must watch a new tube before we can ignore default tube
			const watchPromise 	= Bluebird.promisify(client.watch.bind(client))(tubeName);
			const ignorePromise = Bluebird.promisify(client.ignore.bind(client))('default');
			return Promise.all([watchPromise, ignorePromise]);
		}
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
  purgeQueues() {
    this.notify.debug('Clear all queues');
    const promises = this.queues.map(queue => queue.purgeQueue());
    return Promise.all(promises).then(()=> undefined);
  }

  // Use when testing to wait for all jobs to be processed.  Returns a promise.
  runOnce() {
    const promises 		= this.queues.map(queue => queue.runOnce());
		const awaitAll 		= Promise.all(promises);
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

  get config() {
    // Lazy load configuration.
    return this._ironium.config;
  }

  get notify() {
    return this._ironium;
  }
};

