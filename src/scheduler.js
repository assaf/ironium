// Essentially cron for scheduling tasks in Node.

const assert  = require('assert');
const CronJob = require('cron');
const Q       = require('q');


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
    let cronJob  = CronJob.job(cronTime, (callback)=> this._runJob(name, job, callback));
    cronJob.name = name;
    this._cronJobs[name] = cronJob;
    if (this._startJobs) {
      this._logger.debug("Starting cronjob %s", name);
      cronJob.start();
    }
  }

  _runJob(name, job, callback) {
    this._logger.info("Running cronjob %s", name);
    let outcome = Q.defer();

    outcome.promise
      .then(()=> {
        this._logger.info("Completed cronjob %s", name);
        if (callback)
          setImmediate(callback);
      }, (error)=> {
        this._logger.error(error);
        if (callback)
          callback(error);
      });

    function fulfill(error) {
      if (error)
        outcome.reject(error);
      else
        outcome.resolve();
    }

    let promise = job.call(null, fulfill);
    if (promise && promise.then)
      promise.then(()=> outcome.resolve(),
                   (error)=> outcome.reject(error));

  }

  start() {
    this._startJobs = true;
    for (let cronJob of this._allJobs) {
      this._logger.debug("Starting cronjob %s", cronJob.name);
      cronJob.start();
    };
  }

  stop() {
    this._startJobs = false;
    for (let cronJob of this._allJobs) {
      this._logger.debug("Stopping cronjob %s", cronJob.name);
      cronJob.stop();
    }
  }

  once() {
    // Run job, provide our own completion function.
    function runJob(cronJob) {
      let deferred = Q.defer();
      cronJob._callbacks[0].call(null, function(error) {
        if (error)
          deferred.reject(error);
        else
          deferred.resolve();
      });
      return deferred.promise;
    }
    let promises = this._allJobs.map((cronJob)=> runJob(cronJob));
    return Q.all(promises);
  }

  get _allJobs() {
    return Object.keys(this._cronJobs).map((name)=> this._cronJobs[name]);
  }

}

