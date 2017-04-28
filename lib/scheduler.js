// Essentially cron for scheduling tasks in Node.
'use strict';
const assert  = require('assert');
const debug   = require('debug')('ironium:schedules');
const ms      = require('ms');
const runJob  = require('./run_job');


// Job schedule consists of three properties:
// jobName  - Schedule name (for reporting)
// when     - Number, string or object with
//   start  - Start running after this time
//   every  - Run every so many seconds
//   end    - Do not run after this time
// handler  - Job to run
//
// A schedule can have a start time, but no other properties, in which case the
// job will run exactly once, if the start time is in the future.
//
// A schedule can have recurrence, in which case the job will run every so many
// seconds, with optional start and end time.
class Schedule {

  constructor(scheduler, jobName, when, handler) {
    assert(jobName, 'Schedule missing job name');
    assert(typeof handler === 'function', 'Schedule missing handler function');

    this._scheduler = scheduler;
    this.jobName    = jobName;
    this.handler    = handler;

    if (when instanceof Date)
      this.startTime  = when.getTime();
    else if (typeof when === 'string')
      this.every      = ms(when);
    else if (typeof when === 'number')
      this.every      = parseInt(when, 0);
    else if (typeof when === 'object') {
      this.startTime  = when.start ? +when.start : undefined;
      this.endTime    = when.end   ? +when.end   : undefined;
      this.every      = (typeof when.every === 'string' ? ms(when.every) : parseInt(when.every, 0));
    } else
      assert(false, 'Schedule time must be Date (instance), Number (interval) or object with start/every/end properties');

    assert(this.startTime || this.every, 'Schedule requires either start time or interval (0 not acceptable)');
    if (this.endTime) {
      assert(this.every, 'Schedule with end time requires interval');
      if (this.startTime)
        assert(this.startTime < this.endTime, 'Schedule must start before it ends');
    }

    if (this.every)
      assert(this.every >= ms('60s'), 'Minimum interval is 60 seconds');

    this._queue = this._scheduler.queue(this.jobName);
    this._queue.eachJob(job => this._runJob(job));

    this.resetSchedule();
  }


  // Starts the scheduler for this job.  Sets timer/interval to run the job.
  start() {
    const now = Date.now();
    if (this.endTime && now >= this.endTime)
      return;

    const delay = this._next - now;
    this._timeout = setTimeout(() => this._firstIntance(), delay);
  }


  _firstIntance() {
    this._queueNext();
    if (this.every)
      this._interval = setInterval(() => this._everyInterval(), this.every);
  }


  _everyInterval() {
    if (this.endTime && Date.now() >= this.endTime)
      clearInterval(this._interval);
    else
      this._queueNext();
  }


  // Stops the scheduler for this job.  Resets timer/interval.
  stop() {
    clearTimeout(this._timeout);
    clearInterval(this._interval);
  }


  // Run job once.
  runOnce() {
    const runOnSchedule = this._next && (Date.now() >= this._next);
    // Set schedule to next interval, but also deal with case where clock
    // rewinds (e.g. between different scenarios)
    this.resetSchedule();
    if (runOnSchedule)
      return this._queueJob();
    else
      return Promise.resolve();
  }


  // Reset next time job runs
  resetSchedule() {
    this._next = this._getNextSchedule();
    debug('Set schedule %s to fire next at %s', this.jobName, new Date(this._next).toISOString());
  }


  _getNextSchedule() {
    const now       = Date.now();
    const interval  = this.every;

    if (interval && this.startTime) {

      // This is where every 24h start time 5pm becomes tomorrow 5pm
      const offsetFromStart = Math.max(now - this.startTime, 0) + interval - 1;
      const roundToInterval = offsetFromStart - (offsetFromStart % interval);
      const nextTime        = this.startTime + roundToInterval;
      const futureTime      = (!this.endTime || this.endTime > nextTime) ? nextTime : null;
      return futureTime;

    } else if (interval) {

      // This is where every 24h becomes 0:00 tomorrow
      const inNextInterval  = now + interval;
      const roundToInterval = inNextInterval - (inNextInterval % interval);
      const futureTime      = (!this.endTime || this.endTime > roundToInterval) ? roundToInterval : null;
      return futureTime;

    } else {

      // Only if scheduled for the future; end date makes no sense without
      // interval
      const futureTime = (this.startTime >= now) ? this.startTime : null;
      return futureTime;

    }
  }


  // Queue the job to run one more time.  Cancels interval if past end time.
  _queueNext() {
    return this._queueJob()
      .catch(error => {
        this._scheduler._ironium.reportError(this.jobName, error);
        // Error queuing job. For a one time job, try to queue again. For
        // period job, only queue again if not scheduled to run soon.
        if (!this.every || this.every > ms('10m')) {
          const timeout = setTimeout(() => this._queueNext(), ms('5s'));
          timeout.unref();
        }
      });
  }


  // Queues the job (if allowed by coordination).
  _queueJob() {
    const time = new Date().toISOString();
    return this._scheduler._canScheduleJob(this.jobName, time)
      .then(canSchedule => {
        if (canSchedule)
          return this._queue.queueJob({ time });
        else
          return null;
      })
      .catch(error => {
        this._scheduler._ironium.reportError(this.jobName, error);
        return Promise.reject(error);
      });
  }


  // Picks up the job from the queue and determines whether it
  // should be run or not. See `shouldRunJob()` below.
  _runJob(job) {
    if (shouldRunJob(this, job)) {
      debug('Processing %s, scheduled for %s', this.jobName, job.time);
      return Promise.resolve()
        .then(() => this.handler(job))
        .then(() => {
          debug('Completed %s, scheduled for %s', this.jobName, job.time);
        });
    } else {
      debug('Ignoring this occurrence of %s', this.jobName);
      return Promise.resolve();
    }
  }

}


module.exports = class Scheduler {

  constructor(ironium) {
    // If true, every new job is started automatically.  Necessary in case you
    // call scheduleJob() after calling start().
    this.started      = false;

    this._ironium     = ironium;
    this._schedules   = new Map();
  }


  // Schedules a new job.
  scheduleJob(jobName, when, handler) {
    assert(handler instanceof Function,   'Third argument must be the handler function');
    assert(!this._schedules.has(jobName), `Attempt to schedule multiple jobs with same name (${jobName})`);

    const newSchedule = new Schedule(this, jobName, when, handler);
    this._schedules.set(jobName, newSchedule);

    if (this.started) {
      debug('Starting schedule %s', jobName);
      newSchedule.start();
    }
  }

  // Start all scheduled jobs.
  start() {
    debug('Starting all schedules');
    this.started = true;
    for (const schedule of this._schedules.values())
      schedule.start();
  }

  // Stop all scheduled jobs.
  stop() {
    debug('Stopping all schedules');
    this.started = false;
    for (const schedule of this._schedules.values())
      schedule.stop();
  }

  // Run all schedules jobs in parallel.
  runOnce() {
    const schedules = Array.from(this._schedules.values());
    const promises  = schedules.map(schedule => schedule.runOnce());
    return Promise.all(promises);
  }

  // Returns an array of all schedules.
  get schedules() {
    return Array.from(this._schedules.values());
  }

  // Resets all schedules, used during testing
  resetSchedule() {
    for (const schedule of this._schedules.values())
      schedule.resetSchedule();
  }


  // Use mutex to determine if this process can schedule this job
  _canScheduleJob(jobName, time) {
    return this._ironium.configPromise
      .then(config => config.canScheduleJob || canScheduleJobAlways)
      .then(canScheduleJob => canScheduleJob(jobName, time));
  }

  queue(queueName) {
    return this._ironium.queue(queueName);
  }

};


// canScheduleJob when there is no coordinator, and any worker may schedule the
// job. Applicable for development and testing environments, where you run a
// single worker.
function canScheduleJobAlways() {
  return true;
}


// A scheduled job may be returned to the queue when it fails or times out.
// For recurring jobs, we don't want to run duplicate jobs once the error
// condition is resolved.
// Returns true if the job should be run.
function shouldRunJob(schedule, job) {
  if (schedule) {
    if (schedule.every) {
      const jobTime   = +new Date(job.time);
      const expiredBy = jobTime + schedule.every;
      const isExpired = Date.now() > expiredBy;
      return !isExpired;
    } else {
      // One-offs never expire (i.e. they must be retried until successful).
      return true;
    }
  } else
    return false;
}
