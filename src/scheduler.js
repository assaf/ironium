// Essentially cron for scheduling tasks in Node.

const assert  = require('assert');
const co      = require('co');
const ms      = require('ms');
const runJob  = require('./run_job');


module.exports = class Scheduler {

  constructor(ironium) {
    // If true, every new job is started automatically.  Necessary in case you
    // call schedule() after calling start().
    this.started      = false;

    this._ironium     = ironium;
    this._schedules   = Object.create({});
  }

  // Schedules a new job.
  schedule(name, time, job) {
    assert(job instanceof Function, "Third argument must be the job function");
    assert(!this._schedules[name],   "Attempt to schedule multiple jobs with same name (" + name + ")");

    var schedule = new Schedule(this, name, time, job);
    this._schedules[name] = schedule;

    if (this.started) {
      this.notify.debug("Starting schedule %s", name);
      schedule.start();
    }
  }

  // Start all scheduled jobs.
  start() {
    this.notify.debug("Starting all schedules");
    this.started = true;
    // Not listening until we start up the queue.
    this.queue;
    for (var schedule of this.schedules)
      schedule.start();
  }

  // Stop all scheduled jobs.
  stop() {
    this.notify.debug("Stopping all schedules");
    this.started = false;
    for (var schedule of this.schedules)
      schedule.stop();
  }

  // Run all schedules jobs in parallel.
  *once() {
    yield this.schedules.map((schedule)=> schedule.once());
  }

  // Returns an array of all schedules.
  get schedules() {
    return Object.keys(this._schedules).map((name)=> this._schedules[name]);
  }


  // Schedule calls this to queue the job.
  queueJob(name, callback) {
    var thunk = this.queue.push({ name, time: new Date().toISOString()});
    if (callback)
      thunk(callback);
    else
      return thunk;
  }

  // This is used to pick up job from the queue and run it.
  *_runQueuedJob({ name, time }) {
    var schedule = this._schedules[name];
    if (schedule)
      co(schedule.runJob(time))(function() { });
    else
      this.notify.error("No schedule %s, ignoring", name);
  }

  get queue() {
    // Lazy access to queue -> lazy load configuration.
    //
    // If we attempt to access the queue when new Scheduler created, we will
    // immediately connect to some server, before the application gets a chance
    // to call ironium.configure().
    if (!this._queue) {
      this._queue = this._ironium.queue('$schedule');
      this._queue.each(this._runQueuedJob.bind(this));
    }
    return this._queue;
  }

  get config() {
    // Lazy load configuration.
    return this._ironium.config;
  }

  get notify() {
    return this._ironium;
  }
}


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

    assert(name, "Schedule missing name");
    this.name = name;
    assert(typeof(job) == 'function', "Schedule missing job function");
    this.job  = job;

    if (time instanceof Date) {
      this.startTime = time.getTime();
    } else if (typeof(time) == 'string') {
      this.every = ms(time);
    } else if (typeof(time) == 'number') {
      this.every = parseInt(time, 0);
    } else if (typeof(time) == 'object') {
      var { start, every, end } = time;
      this.startTime = start ? +start : undefined;
      this.endTime   = end   ? +end   : undefined;
      this.every     = (typeof(every) == 'string' ? ms(every) : parseInt(every, 0));
    } else
      throw new Error("Schedule time must be Date (instance), Number (interval) or object with start/every/end properties");

    assert(this.startTime || this.every, "Schedule requires either start time or interval (0 not acceptable)");
    if (this.endTime) {
      assert(every, "Schedule with end time requires interval");
      if (this.startTime)
        assert(this.startTime < this.endTime, "Schedule must start before it ends");
    }
  }

  // Starts the scheduler for this job.  Sets timer/interval to run the job.
  start() {
    if (this.endTime && now >= this.endTime)
      return;

    if (this.startTime && now < this.startTime) {
      this._timeout = setTimeout(()=> {
        this._timeout = null;
        // Set interval first, _queueNext will clear it, if we're already past
        // the end time.
        if (this.every)
          this._interval = setInterval(this._queueNext.bind(this), this.every);
        this._queueNext();
      }, now - this.startTime);
    } else if (this.every) {
      // Interval works the same way, except queueNext will call start again.
      this._interval = setInterval(this._queueNext.bind(this), this.every);
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
  *once() {
    var now = Date.now();
    if ((!this.startTime || now >= this.startTime) &&
        (!this.endTime || now < this.endTime)) {
      yield this.runJob(this);
    }
  }

  // Queue the job to run one more time.  Cancels interval if past end time.
  _queueNext() {
    if (this._interval && this.endTime && Date.now() >= this.endTime)
      clearInterval(this._interval);
    this._scheduler.queueJob(this.name, (error)=> {
      if (error) {
        // Error queuing job. For a one time job, try to queue again. For
        // period job, only queue again if not scheduled to run soon.
        if (!this.every || this.every > ms('1m'))
          setTimeout(this._queueNext.bind(this), ms('5s'));
      }
    });
  }

  // Scheduler calls this to actually run the job when picked up from queue.
  *runJob(time) {
    try {
      this.notify.info("Processing %s, scheduled for %s", this.name, time);
      yield (resume)=> runJob(this.job, [], undefined, resume);
      this.notify.info("Completed %s, scheduled for %s", this.name, time);
    } catch (error) {
      this.notify.error("Error %s, scheduled for %s", this.name, time, error.stack);
      throw error;
    }
  }

  get notify() {
    return this._scheduler.notify;
  }

}

