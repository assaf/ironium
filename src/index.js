const assert            = require('assert');
const { EventEmitter }  = require('events');
const { format }        = require('util');
const Queues            = require('./queues');
const Scheduler         = require('./scheduler');
const runner            = require('./runner');


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
    this._queues    = new Queues(this);
    this._scheduler = new Scheduler(this);
  }

  // Returns the named queue.  Returned objects has the methods `push` and
  // `each`, properties `name` and `webhookURL`.
  queue(name) {
    return this._queues.getQueue(name);
  }

  // Schedules a new job to run periodically/once.
  //
  // name - Job name, used for reporting / monitoring
  // time - Cron time pattern
  // job  - The job to run
  //
  // Job is called with a callback, may also return a promise.
  schedule(name, time, job) {
    this._scheduler.schedule(name, time, job);
  }

  // Update configuration.
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

  // Calls the function with a callback that fulfills a promise, returns that
  // promise.
  fulfill(...args) {
    return runner.fulfill(...args);
  }

  // Used in testing: run all scheduled jobs once (immediately), run all queued
  // jobs, finally call callback.  If called with no arguments, returns a promise.
  once(callback) {
    // Must run all scheduled jobs first, only then can be run any (resulting)
    // queued jobs to completion.
    let promise = this._scheduler.once()
      .then(()=> this._queues.once())
      .then(()=> {
        this.debug("Completed all jobs");
      });
    return returnPromiseOrCallback(promise, callback);
  }

  // Used in testing: empties all queues.
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

