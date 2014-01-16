// Need runtime to support generators.
require('traceur');

const co                = require('co');
const { EventEmitter }  = require('events');
const { format }        = require('util');
const Configuration     = require('./configuration');
const Queues            = require('./queues');
const Scheduler         = require('./scheduler');


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
  // jobs, finally call callback.  If called with no arguments, returns a thunk.
  once(callback) {
    var thunk = co(function*() {

      // Must run all scheduled jobs first, only then can be run any (resulting)
      // queued jobs to completion.
      yield this._scheduler.once();
      yield this._queues.once();
      this.debug("Completed all jobs");

    }.call(this));
    if (callback)
      thunk(callback);
    else
      return thunk;
  }

  // Used in testing: empties all queues.  If called with no arguments, returns
  // a thunk.
  reset(callback) {
    var thunk = co(this._queues.reset());
    if (callback)
      thunk(callback);
    else
      return thunk;
  }

  // Used for logging debug messages.
  debug(...args) {
    this.emit('debug', format(...args));
  }

  // Used for logging info messages.
  info(...args) {
    this.emit('info', format(...args));
  }

  // Used for logging error messages.
  error(...args) {
    let error = (args.length == 1 && args[0] instanceof Error) ?
      args[0] :
      new Error(format(...args));
    this.emit('error', error);
  }

}


module.exports = new Ironium();

