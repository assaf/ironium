// Need runtime to support generators.
require('traceur');

var debug             = require('debug')('ironium');
var { EventEmitter }  = require('events');
var { format }        = require('util');
var Configuration     = require('./configuration');
var Queues            = require('./queues');
var Scheduler         = require('./scheduler');


class Ironium extends EventEmitter {

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
  // time - Run time, see below
  // job  - The job to run
  //
  // Job is called with a callback, may also return a promise, or generator.
  //
  // The scheduled time can be one of:
  // - Integer interval
  // - String interval takes the form of "1s", "5m", "6h", etc
  // - Date, run the job once at the specified time
  // - An object with the properties start, end and every
  //
  // If the start property is set, the schedule runs first on that time, and
  // repeatedly if the property every specifies an interval.  If the end
  // property is set, the schedule stops at that set time.  If only the every
  // property is set, the schedule runs on that specified interval.
  schedule(name, time, job) {
    this._scheduler.schedule(name, time, job);
  }

  // Update configuration.
  configure(config) {
    this._config = new Configuration(config);
  }

  // Get the current/default configuration.
  get config() {
    if (!this._config)
      this._config = new Configuration();
    return this._config;
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

  // Used in testing: run all scheduled jobs once (immediately), run all queued
  // jobs, finally call callback.  If called with no arguments, returns a promise.
  once(callback) {
    // Must run all scheduled jobs first, only then can be run any (resulting)
    // queued jobs to completion.
    var promise = this._scheduler.once()
      .then(()=> this._queues.once() )
      .then(()=> this.debug("Completed all jobs") );
    if (callback)
      promise.then(()=> callback(), callback);
    else
      return promise;
  }

  // Used in testing: empties all queues.  If called with no arguments, returns
  // a promise.
  reset(callback) {
    var promise = this._queues.reset();
    if (callback)
      promise.then(()=> callback(), callback);
    else
      return promise;
  }

  // Used for logging debug messages.
  debug(...args) {
    if (this.listeners('debug').length)
      this.emit('debug', format(...args));
    else
      debug(...args);
  }

  // Used for logging info messages.
  info(...args) {
    if (this.listeners('info').length)
      this.emit('info', format(...args));
    else
      debug(...args);
  }

}


module.exports = new Ironium();

