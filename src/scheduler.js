// Essentially cron for scheduling tasks in Node.

const assert  = require('assert');
const Async   = require('async');
const CronJob = require('cron');


// In production we respect the cron schedule set by the application.
//
// In development, all jobs run continusously every 5 seconds.
//
// In test, you can run all jobs by calling once().
const DEVELOPMENT_CRON_TIME = '*/5 * * * * *';


module.exports = class Scheduler {

  // Create a new scheduled.
  //
  // logger       - For logging debug, info and error messages
  // development  - If true, all jobs run every few seconds
  constructor(logger, development = false) {
    this._logger      = logger;
    this._development = development;
    this._cronJobs    = Object.create({});
    // If true, every new job is started automatically.  Necessary in case you
    // call schedule() after calling start().
    this._startJobs   = false;
  }

  schedule(name, time, job) {
    assert(!this._cronJobs[name], "Attempt to schedule multiple jobs with same name (" + name + ")")
    let cronTime = this._development ? DEVELOPMENT_CRON_TIME : time;
    let cronJob  = CronJob.job(cronTime, (callback)=> {

      this._logger.info("Running cronjob %s", name);
      job.call(null, (error)=> {
        if (error)
          this._logger.error(error);
        else
          this._logger.info("Completed cronjob %s", name);
        if (callback)
          callback(error);
      });

    });
    cronJob.name = name;
    this._cronJobs[name] = cronJob;
    if (this._startJobs) {
      this._logger.debug("Starting cronjob %s", name);
      cronJob.start();
    }
  }

  start() {
    this._startJobs = true;
    this._forEach((cronJob)=> {
      this._logger.debug("Starting cronjob %s", cronJob.name);
      cronJob.start();
    });
  }

  stop() {
    this._startJobs = false;
    this._forEach((cronJob)=> {
      this._logger.debug("Stopping cronjob %s", cronJob.name);
      cronJob.stop();
    });
  }

  once(callback) {
    assert(callback, "Callback required");
    // Run job, provide our own completion function.
    function runJob(cronJob, done) {
      cronJob._callbacks[0].call(null, done);
    }
    this._forEach(runJob, callback);
  }

  _forEach(fn, callback) {
    let cronJobs = Object.keys(this._cronJobs).map((name)=> this._cronJobs[name]);
    if (arguments.length > 1)
      Async.forEach(cronJobs, fn, callback);
    else
      cronJobs.forEach(fn);
  }

}

