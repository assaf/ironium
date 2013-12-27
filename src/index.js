// Need runtime to support generators.
require(require.resolve('traceur') + '/../../runtime/runtime');

const co                = require('co');
const { EventEmitter }  = require('events');
const { format }        = require('util');
const Queues            = require('./queues');
const Scheduler         = require('./scheduler');


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
}


module.exports = new Workers();

