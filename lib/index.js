// Main entry point.  Exports a single instance of Ironium.
//
// You can use most instance methods unbound, e.g.:
//
//   before(Ironium.runOnce)
//
// You can also create multiple instances if you need to:
//
//   const instance = new (Ironium.constructor)();
//
//
// DEBUG=ironium
//   Shows any errors reported when processing jobs
//   Shows when runOnce completes (useful in testing)


'use strict';
const debug           = require('debug')('ironium');
const EventEmitter    = require('events');
const Configuration   = require('./configuration');
const Queues          = require('./queues');
const Scheduler       = require('./scheduler');


class Ironium  {

  constructor(config) {
    this._queues    = new Queues(this);
    this._scheduler = new Scheduler(this);
    this._errors    = new EventEmitter();

    // Register default event handler, so we a) have debug output in case of
    // error, and b) don't crash process in case of error, since Ironium is all
    // about retrying failed jobs.
    this._errors.on('error', function(error, subject) {
      debug('Error in %s: %s', subject, error.stack);
    });

    if (config)
      this.configure(config);


    // Bind methods so before(Ironium.once) works.
    this.eachJob        = Ironium.prototype.eachJob.bind(this);
    this.queue          = Ironium.prototype.queue.bind(this);
    this.queueJob       = Ironium.prototype.queueJob.bind(this);
    this.scheduleJob    = Ironium.prototype.scheduleJob.bind(this);
    this.start          = Ironium.prototype.start.bind(this);
    this.stop           = Ironium.prototype.stop.bind(this);
    this.runOnce        = Ironium.prototype.runOnce.bind(this);
    this.purgeQueues    = Ironium.prototype.purgeQueues.bind(this);
    this.resetSchedule  = Ironium.prototype.resetSchedule.bind(this);
  }


  // -- General methods --

  // Returns the named queue.
  queue(queueName) {
    return this._queues.getQueue(queueName);
  }

  // Queues a job in the named queue.
  //
  // Returns a promise that resolves to the job ID.
  //
  // Same as queue(queueName).queueJob(job)
  queueJob(queueName, job) {
    return this.queue(queueName).queueJob(job);
  }

  // Schedules a new job to run periodically/once.
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
  scheduleJob(jobName, when, handler) {
    this._scheduler.scheduleJob(jobName, when, handler);
  }

  // Register handler for the given queue.
  //
  // Same as queue(queueName).eachJob(handler)
  eachJob(queueName, handler) {
    this._queues.getQueue(queueName).eachJob(handler);
  }

  webhookURL(queueName) {
    return this.configPromise.then(config => config.webhookURL(queueName));
  }


  // -- Configure --

  // Update configuration.  Configuration can be an object or a promise.
  configure(config) {
    this._configPromise = Promise.resolve(config)
      .then(config => new Configuration(config));
  }

  // Register to be notified of processing errors.
  onerror(handler) {
    this._errors.on('error', handler);
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


  // -- For testing --

  // Used in testing: run all jobs at once.
  runOnce() {
    // Must run all scheduled jobs first, only then can be run any (resulting)
    // queued jobs to completion.
    return Promise.resolve()
      .then(()=> this._scheduler.runOnce() )
      .then(()=> this._queues.runOnce() )
      .then(()=> debug('Completed all jobs') );
  }

  // Used in testing: empties all queues.
  purgeQueues() {
    return this._queues.purgeQueues();
  }

  // Reset the next run time for all scheduled jobs based on the current system clock.
  resetSchedule() {
    this._scheduler.resetSchedule();
  }


   // -- Hidden --

  // Get the current/default configuration.  Resolves to Configuration object.
  get configPromise() {
    if (!this._configPromise)
      this._configPromise = Promise.resolve(new Configuration());
    return this._configPromise;
  }

  // Used internally to report an error
  //
  // subject - queue or schedule
  // error   - Error object
  reportError(subject, error) {
    this._errors.emit('error', error, subject);
  }

}


module.exports = new Ironium();
