// Essentially cron for scheduling tasks in Node.

const assert  = require('assert');
const ms      = require('ms');
const Promise = require('bluebird');
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
    this._notify    = scheduler._notify;

    assert(name, 'Schedule missing name');
    this.name = name;
    assert(typeof(job) == 'function', 'Schedule missing job function');
    this.job  = job;

    if (time instanceof Date) {
      this.startTime = time.getTime();
    } else if (typeof(time) == 'string') {
      this.every = ms(time);
    } else if (typeof(time) == 'number') {
      this.every = parseInt(time, 0);
    } else if (typeof(time) == 'object') {
      const { start, every, end } = time;
      this.startTime = start ? +start : undefined;
      this.endTime   = end   ? +end   : undefined;
      this.every     = (typeof(every) == 'string' ? ms(every) : parseInt(every, 0));
    } else
      throw new Error('Schedule time must be Date (instance), Number (interval) or object with start/every/end properties');

    assert(this.startTime || this.every, 'Schedule requires either start time or interval (0 not acceptable)');
    if (this.endTime) {
      assert(this.every, 'Schedule with end time requires interval');
      if (this.startTime)
        assert(this.startTime < this.endTime, 'Schedule must start before it ends');
    }
  }

  // Starts the scheduler for this job.  Sets timer/interval to run the job.
  start() {
    const now = Date.now();
    if (this.endTime && now >= this.endTime)
      return;

    if (this.startTime && now < this.startTime) {
      this._timeout = setTimeout(()=> {
        this._timeout = null;
        // Set interval first, _queueNext will clear it, if we're already past
        // the end time.
        if (this.every) {
          this._interval = setInterval(this._queueNext.bind(this), this.every);
          this._interval.unref();
        }
        this._queueNext();
      }, now - this.startTime);
      this._timeout.unref();
    } else if (this.every) {
      // Interval works the same way, except queueNext will call start again.
      this._interval = setInterval(this._queueNext.bind(this), this.every);
      this._interval.unref();
    }
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
  once() {
    const now = Date.now();
    if ((!this.startTime || now >= this.startTime) &&
        (!this.endTime || now < this.endTime)) {
      return this._scheduler.queueJob(this.name);
    } else
      return Promise.resolve();
  }

  // Queue the job to run one more time.  Cancels interval if past end time.
  _queueNext() {
    if (this._interval && this.endTime && Date.now() >= this.endTime)
      clearInterval(this._interval);
    this._scheduler.queueJob(this.name)
      .catch(()=> {
        // Error queuing job. For a one time job, try to queue again. For
        // period job, only queue again if not scheduled to run soon.
        if (!this.every || this.every > ms('1m')) {
          const timeout = setTimeout(this._queueNext.bind(this), ms('5s'));
          timeout.unref();
        }
      });
  }

  // Scheduler calls this to actually run the job when picked up from queue.
  _runJob(time) {
    this._notify.info('Processing %s, scheduled for %s', this.name, time.toString());
    return runJob(this.name, this.job, [], undefined)
      .then(()=> this._notify.info('Completed %s, scheduled for %s', this.name, time.toString()) )
      .catch((error)=> {
        this._notify.error('Error %s, scheduled for %s', this.name, time.toString(), error);
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
    this._notify      = ironium;
  }

  // Schedules a new job.
  schedule(name, time, job) {
    assert(job instanceof Function, 'Third argument must be the job function');
    assert(!this._schedules[name],  `Attempt to schedule multiple jobs with same name (${name})`);

    const newSchedule = new Schedule(this, name, time, job);
    this._schedules[name] = newSchedule;

    if (this.started) {
      this._notify.debug('Starting schedule %s', name);
      newSchedule.start();
    }
  }

  // Start all scheduled jobs.
  start() {
    this._notify.debug('Starting all schedules');
    this.started = true;
    // Not listening until we start up the queue.
    this._startQueue();
    for (let schedule of this.schedules)
      schedule.start();
  }

  // Stop all scheduled jobs.
  stop() {
    this._notify.debug('Stopping all schedules');
    this.started = false;
    for (let schedule of this.schedules)
      schedule.stop();
  }

  // Run all schedules jobs in parallel.
  once() {
    const schedules = this.schedules.map((schedule)=> schedule.once());
    return Promise.all(schedules);
  }

  // Returns an array of all schedules.
  get schedules() {
    return Object.keys(this._schedules).map((name)=> this._schedules[name]);
  }


  // Schedule calls this to queue the job.
  queueJob(name) {
    return this.queue.push({ name: name, time: new Date().toISOString()});
  }

  // This is used to pick up job from the queue and run it.
  _runQueuedJob({ name, time }) {
    const schedule = this._schedules[name];
    if (schedule)
      return schedule._runJob(time);
    else {
      this._notify.info('No schedule %s, ignoring', name);
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
      this._queue.each(this._runQueuedJob.bind(this));
    }
  }

  get queue() {
    this._startQueue();
    return this._queue;
  }

  get config() {
    // Lazy load configuration.
    return this._ironium.config;
  }

};

