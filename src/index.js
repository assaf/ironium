const assert            = require('assert');
const Async             = require('async');
const { EventEmitter }  = require('events');
const { format }        = require('util');
const Queues            = require('./queues');
const Scheduler         = require('./scheduler');


class Workers extends EventEmitter {

  constructor() {
    EventEmitter.call(this);
  }


  // Returns the named queue.  Returned objects has the methods `put` and
  // `process`.
  queue(name) {
    return this.queues.getQueue(name);
  }

  get queues() {
    let queues = this._queues;
    if (!queues) {
      queues = new Queues(this);
      this._queues = queues;
    }
    return queues;
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
    this.scheduler.schedule(name, time, job);
  }

  get scheduler() {
    let scheduler = this._scheduler;
    if (!scheduler) {
      scheduler = new Scheduler(this, process.env.NODE_ENV == 'development');
      this._scheduler = scheduler;
    }
    return scheduler;
  }


  configure(config) {
    this._config = config;
  }

  // Start running scheduled and queued jobs.
  start() {
    this.scheduler.start();
    this.queues.start();
  }

  // Stop running scheduled and queued jobs.
  stop() {
    this.scheduler.stop();
    this.queues.stop();
  }


  // Run all scheduled jobs once (immediately) and run all queued jobs, then
  // call callbacks.  Used during tests.
  once(callback) {
    assert(callback, "Callback required");
    this.scheduler.once((error)=> {
      if (error)
        callback(error);
      else
        this.queues.once(callback);
    });
  }

  // Empty all queues.  Used duting tests.
  reset(callback) {
    assert(callback, "Callback required");
    this.queues.reset(callback);
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

