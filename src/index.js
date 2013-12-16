const assert            = require('assert');
const { EventEmitter }  = require('events');
const { format }        = require('util');
const Q                 = require('q');
const Queues            = require('./queues');
const Scheduler         = require('./scheduler');


function returnPromiseOrCallback(promise, callback) {
  if (callback)
    promise.then(function() {
      setImmediate(callback);
    }, function(error) {
      callback(error);
    });
  else
    return promise;
}


class Workers extends EventEmitter {

  constructor() {
    EventEmitter.call(this);
    this._queues = new Queues(this);
    this._scheduler = new Scheduler(this, process.env.NODE_ENV == 'development');
  }


  // Returns the named queue.  Returned objects has the methods `push` and
  // `each`.
  queue(name) {
    return this._queues.getQueue(name);
  }


  // Schedules a new job to run periodically/once.
  //
  // name - Job name, used for reporting / monitoring
  // time - Cron time pattern
  // job  - The job to run
  //
  // The job function is called with a callback, which it uses to report
  // completion or an error.
  schedule(name, time, job) {
    this._scheduler.schedule(name, time, job);
  }


  configure(config) {
    this._config = config;
  }

  // Start running scheduled and queued jobs.
  start() {
    this._scheduler.start();
    this._queues.start();
  }

  // Stop running scheduled and queued jobs.
  stop() {
    this._scheduler.stop();
    this._queues.stop();
  }


  // Run all scheduled jobs once (immediately) and run all queued jobs, then
  // call callbacks.  Used during tests.
  once(callback) {
    // Must run all scheduled jobs first, the run any (resulting) queued jobs
    // to completion.
    let promise = this._scheduler.once()
      .then(()=> this._queues.once())
      .then(()=> {
        this.debug("Completed all jobs");
      });
    return returnPromiseOrCallback(promise, callback);
  }

  // Empty all queues.  Used duting tests.
  reset(callback) {
    let promise = this._queues.reset(callback);
    return returnPromiseOrCallback(promise, callback);
  }


  // Used for logging debug messages.
  debug(message, ...args) {
    this.emit('debug', format(message, ...args));
  }

  // Used for logging info messages.
  info(message, ...args) {
    this.emit('info', format(message, ...args));
  }

  // Used for reporting errors.  First argument may be an error or formatting
  // string.
  error(messageOrError, ...args) {
    if (messageOrError instanceof Error)
      this.emit('error', messageOrError);
    else {
      let message = format(messageOrError, ...args);
      this.emit('error', new Error(message));
    }
  }
}


module.exports = new Workers();

