// Essentially cron for scheduling tasks in Node.
'use strict';
const assert  = require('assert');
const debug   = require('debug')('ironium:schedules');
const ms      = require('ms');
const runJob  = require('./run_job');


// Job schedule consists of three properties:
// name  - Schedule name (for reporting)
// job   - Job to run
// start - Start running after this time
// every - Run every so many seconds
// end   - Do not run after this time
//
// A schedule can have a start time, but no other properties, in which case the
// job will run exactly once, if the start time is in the future.
//
// A schedule can have recurrence, in which case the job will run every so many
// seconds, with optional start and end time.
class Schedule {

  constructor(scheduler, name, time, job) {
    this._scheduler = scheduler;

    assert(name, 'Schedule missing name');
    this.name = name;
    assert(typeof job === 'function', 'Schedule missing job function');
    this.job  = job;

    if (time instanceof Date)
      this.startTime = time.getTime();
    else if (typeof time === 'string')
      this.every = ms(time);
    else if (typeof time === 'number')
      this.every = parseInt(time, 0);
    else if (typeof time === 'object') {
      this.startTime = time.start ? +time.start : undefined;
      this.endTime   = time.end   ? +time.end   : undefined;
      this.every     = (typeof time.every === 'string' ? ms(time.every) : parseInt(time.every, 0));
    } else
      throw new Error('Schedule time must be Date (instance), Number (interval) or object with start/every/end properties');

    assert(this.startTime || this.every, 'Schedule requires either start time or interval (0 not acceptable)');
    if (this.endTime) {
      assert(this.every, 'Schedule with end time requires interval');
      if (this.startTime)
        assert(this.startTime < this.endTime, 'Schedule must start before it ends');
    }

    this.resetSchedule();
  }

  // Starts the scheduler for this job.  Sets timer/interval to run the job.
  start() {
    const now = Date.now();
    if (this.endTime && now >= this.endTime)
      return;

    this._timeout = setTimeout(()=> {
      this._timeout = null;
      this._queueNext();

      if (this.every)
        this._interval = setInterval(()=> {

          if (this.endTime && now >= this.endTime)
            clearInterval(this._interval);
          else
            this._queueNext();

        }, this.every);

    }, this._next - now);
  }

  // Stops the scheduler for this job.  Resets timer/interval.
  stop() {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  // Run job once.
  runOnce() {
    const runOnSchedule = this._next && (Date.now() >= this._next);
    // Set schedule to next interval, but also deal with case where clock
    // rewinds (e.g. between different scenarios)
    this.resetSchedule();
    if (runOnSchedule)
      return this._scheduler.queueJob(this.name);
    else
      return Promise.resolve();
  }

  // Reset next time job runs
  resetSchedule() {
    this._next = this._getNextSchedule();
    debug('Set schedule %s to fire next at %s', this.name, new Date(this._next).toISOString());
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
    this._scheduler.queueJob(this.name)
      .catch(()=> {
        // Error queuing job. For a one time job, try to queue again. For
        // period job, only queue again if not scheduled to run soon.
        if (!this.every || this.every > ms('1m')) {
          const timeout = setTimeout(()=> this._queueNext(), ms('5s'));
          timeout.unref();
        }
      });
  }

  // Scheduler calls this to actually run the job when picked up from queue.
  _runJob(time) {
    debug('Processing %s, scheduled for %s', this.name, time.toString());
    return runJob(this.name, this.job, [], undefined)
      .then(()=> {
        debug('Completed %s, scheduled for %s', this.name, time.toString());
      })
      .catch((error)=> {
        this._scheduler._ironium.reportError(`${this.name}@${time}`, error);
        debug('Error %s, scheduled for %s', this.name, time.toString(), error);
      });
  }

}

module.exports = class Scheduler {

  constructor(ironium) {
    // If true, every new job is started automatically.  Necessary in case you
    // call schedule() after calling start().
    this.started      = false;

    this._ironium     = ironium;
    this._schedules   = Object.create({});
  }

  // Schedules a new job.
  scheduleJob(name, time, job) {
    assert(job instanceof Function, 'Third argument must be the job function');
    assert(!this._schedules[name],  `Attempt to schedule multiple jobs with same name (${name})`);

    const newSchedule = new Schedule(this, name, time, job);
    this._schedules[name] = newSchedule;

    if (this.started) {
      debug('Starting schedule %s', name);
      newSchedule.start();
    }
  }

  // Start all scheduled jobs.
  start() {
    debug('Starting all schedules');
    this.started = true;
    // Not listening until we start up the queue.
    this._startQueue();
    for (let schedule of this.schedules)
      schedule.start();
  }

  // Stop all scheduled jobs.
  stop() {
    debug('Stopping all schedules');
    this.started = false;
    for (let schedule of this.schedules)
      schedule.stop();
  }

  // Run all schedules jobs in parallel.
  runOnce() {
    const schedules = this.schedules.map((schedule)=> schedule.runOnce());
    return Promise.all(schedules);
  }

  // Returns an array of all schedules.
  get schedules() {
    return Object.keys(this._schedules).map((name)=> this._schedules[name]);
  }

  // Resets all schedules, used during testing
  resetSchedule() {
    for (let schedule of this.schedules)
      schedule.resetSchedule();
  }



  // Schedule calls this to queue the job.
  queueJob(name) {
    return this.queue.queueJob({ name: name, time: new Date().toISOString()});
  }

  // This is used to pick up job from the queue and run it.
  _runQueuedJob(params) {
    const name     = params.name;
    const time     = params.time;
    const schedule = this._schedules[name];
    if (schedule)
      return schedule._runJob(time);
    else {
      debug('No schedule %s, ignoring', name);
      return Promise.resolve();
    }
  }

  // Lazy access to queue -> lazy load configuration.
  //
  // If we attempt to access the queue when new Scheduler created, we will
  // immediately connect to some server, before the application gets a chance
  // to call ironium.configure().
  _startQueue() {
    if (!this._queue) {
      this._queue = this._ironium.queue('$schedule');
      this._queue.eachJob((job)=> this._runQueuedJob(job));
    }
  }

  get queue() {
    this._startQueue();
    return this._queue;
  }

};

