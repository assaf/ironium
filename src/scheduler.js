// Essentially cron for scheduling tasks in Node.

const _       = require('lodash');
const assert  = require('assert');
const CronJob = require('cron');


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

    let cronTime = this._development ? DEVELOPMENT_CRON_TIME : time;
    let cronJob  = CronJob.job(cronTime, this._runJob.bind(this, name, job));
    cronJob.name = name;
    this._cronJobs[name] = cronJob;

    if (this._startJobs) {
      this.notify.debug("Starting cronjob %s", name);
      cronJob.start();
    }
  }

  // Start all scheduled jobs.
  start() {
    this._startJobs = true;
    _.values(this._cronJobs).forEach((cronJob)=> {
      this.notify.debug("Starting cronjob %s", cronJob.name);
      cronJob.start();
    });
  }

  // Stop all scheduled jobs.
  stop() {
    this._startJobs = false;
    _.values(this._cronJobs).forEach((cronJob)=> {
      this.notify.debug("Stopping cronjob %s", cronJob.name);
      cronJob.stop();
    });
  }

  // Run all schedules jobs in parallel.
  once() {
    let cronJobs = _.values(this._cronJobs);
    let promises = cronJobs.map((cronJob)=> cronJob._callbacks[0]() );
    return Promise.all(promises);
  }

  // Runs the named job.  This is used to wrap the actual job function with
  // logging messages, error notification, and returns a promise that `once()`
  // uses to wait for all scheduled jobs to complete.
  _runJob(name, job) {
    let promise;

    this.notify.info("Running cronjob %s", name);
    if (job.length == 1) {

      // Job accepts a callback.
      promise = new Promise(function(resolve, reject) {
        job(function(error) {
          if (error)
            reject(error);
          else
            resolve();
        });
      });

    } else {

      // Job returns a promise (maybe).
      let jobPromise = job();
      promise = (jobPromise && jobPromise.then) ? jobPromise : Promise.resolve();

    }

    promise.then(()=> {
      this.notify.info("Completed cronjob %s", name);
    }, (error)=> {
      this.notify.error(error);
    });
    return promise;
  }

}

