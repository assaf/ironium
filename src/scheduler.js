// Essentially cron for scheduling tasks in Node.

const assert  = require('assert');
const co      = require('co');
const CronJob = require('cron');
const runJob  = require('./run_job');


// In production we respect the cron schedule set by the application.
//
// In development, all jobs run continusously every 5 seconds.
//
// In test, you can run all jobs by calling once().
const DEVELOPMENT_CRON_TIME = '*/5 * * * * *';


module.exports = class Scheduler {

  constructor(workers) {
    this.notify       = workers;
    this._development = process.env.NODE_ENV == 'development';
    this._cronJobs    = Object.create({});
    // If true, every new job is started automatically.  Necessary in case you
    // call schedule() after calling start().
    this._startJobs   = false;
  }

  // Schedules a new job.
  schedule(name, time, job) {
    assert(job instanceof Function, "Third argument must be the job function");
    assert(!this._cronJobs[name],   "Attempt to schedule multiple jobs with same name (" + name + ")")

    var cronTime = this._development ? DEVELOPMENT_CRON_TIME : time;
    var cronJob  = CronJob.job(cronTime, (callback)=> {
      this.notify.info("Processing scheduled job %s", name);
      runJob(job, [], undefined, (error)=> {
        if (error)
          this.notify.info("Error processing scheduled job %s: %s", name, error.stack);
        else
          this.notify.info("Completed scheduled job %s", name);
        if (callback)
          callback(error);
      });
    });
    this._cronJobs[name] = cronJob;

    if (this._startJobs) {
      this.notify.debug("Starting cronjob %s", name);
      cronJob.start();
    }
  }

  // Start all scheduled jobs.
  start() {
    this._startJobs = true;
    for (var name in this._cronJobs) {
      var cronJob = this._cronJobs[name];
      this.notify.debug("Starting cronjob %s", name);
      cronJob.start();
    }
  }

  // Stop all scheduled jobs.
  stop() {
    this._startJobs = false;
    for (var name in this._cronJobs) {
      var cronJob = this._cronJobs[name];
      this.notify.debug("Stopping cronjob %s", name);
      cronJob.stop();
    }
  }

  // Run all schedules jobs in parallel.
  *once() {
    var jobs = [];
    for (var name in this._cronJobs) {
      var cronJob = this._cronJobs[name];
      // Remember, the first callback is a runJob() that returns a thunk.
      // Nothing happens if we don't call it.
      jobs.push(cronJob._callbacks[0]);
    }
    yield jobs;
  }


}

