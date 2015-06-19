const debug             = require('debug')('ironium');
const { EventEmitter }  = require('events');
const { format }        = require('util');
const Configuration     = require('./configuration');
const Queues            = require('./queues');
const Scheduler         = require('./scheduler');


class Ironium extends EventEmitter {

  constructor() {
    super();
    this._queues      = new Queues(this);
    this._scheduler   = new Scheduler(this);
    this.debug        = debug;

    // Bind methods so before(Ironium.once) works.
    this.queue        = this.queue.bind(this);
    this.queueJob     = this.queueJob.bind(this);
    this.scheduleJob  = this.scheduleJob.bind(this);
    this.start        = this.start.bind(this);
    this.stop         = this.stop.bind(this);
    this.runOnce      = this.runOnce.bind(this);
    this.purgeQueues  = this.purgeQueues.bind(this);
  }

  // Returns the named queue.  Returned objects has the methods `queueJob` and
  // `eachJob`, properties `name` and `webhookURL`.
  queue(name) {
    return this._queues.getQueue(name);
  }

  // Queues job in the named queue.  Same as queue(name).queueJob(job,
  // callback).  If called with two arguments, returns a promise.
  queueJob(name, job, callback) {
    return this.queue(name).queueJob(job, callback);
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
  scheduleJob(name, time, job) {
    this._scheduler.scheduleJob(name, time, job);
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
  runOnce(callback) {
    // Must run all scheduled jobs first, only then can be run any (resulting)
    // queued jobs to completion.
    const promise =
      this._scheduler.runOnce()
      .then(()=> this._queues.runOnce() )
      .then(()=> this.debug('Completed all jobs') );
    if (callback)
      promise.then(callback, callback);
    else
      return promise;
  }

  // Used in testing: empties all queues.  If called with no arguments, returns
  // a promise.
  purgeQueues(callback) {
    const promise = this._queues.purgeQueues();
    if (callback)
      promise.then(callback, callback);
    else
      return promise;
  }

  // Used for logging info messages.
  info(...args) {
    const formatted = format(...args);
    this.debug('%s', formatted);
    this.emit('info', formatted);
  }

  // Used for logging error messages.
  //
  // First argument is formatted string, followed by any number of arguments,
  // last argument is always the Error object.
  error(...args) {
    this.debug(...args);
    if (this.listeners('error').length) {
      const error = args.pop();
      this.emit('error', error);
    }
  }

}


module.exports = new Ironium();

