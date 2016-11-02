# 4.0.0

Added processing concurrency. By default, Ironium will run 10 concurrent jobs.
This can be configured via the `concurrency` option.

Multiple jobs can be queued in a single API call: `Queue#queueJobs(jobs)`.

Dropped support for callbacks and generator functions. Job handlers must return
a promise now.


# 3.2.2

Fixed bug in error handling when queuing scheduled job.


# 3.2.1

Solved the mysterious case of the undeleted job.


# 3.2.0

Synchronize multiple workers, so they only schedule each job once.


# 3.1.4

Fixed reservation timeout, should be 10 minutes, not 1 second.


# 3.1.3

Fixed back-off timeout, should be 10 minutes, not 1 minute.


# 3.1.2

Don't reserve and run a job after queue stopped; release with no delay.


# 3.1.1

Stop Bluebird from complaining about empty promises.


# 3.1.0

Scheduled jobs should throw, especially for runOnce.


# 3.0.1

Minor bug fix when running test suite, purgeQueues would fail to work correctly.


# 3.0.0

Ironium 3.x works with IronMQ v3 and can still run in development mode against
Beanstalkd (no authentication).

Ironium 3.x requires Node 4.x or later.

Methods like queueJob, runOnce, etc that previously took a callback no longer
accept a callback.  Everything returns a promise.

Configuration has changed, so check the README again.  You can now use
`iron.json` as the configuration object, e.g:

  const config = require('iron.json');
  ironium.configure(config);

Debug messages have been split.  Use DEBUG=ironium to see processing
instructions, and DEBUG=ironium:* to see everything else reported.

To listen to processing errors, use ironium.onerror(callback).

To get the webhook URL of a queue, use ironium.webhookURL(queueName).  This
method returns a promise that resolves to the webhook URL.

The width argument to eachJob is gone (for now).


# 2.8.0

Upgraded to Bluebird 3.x.  This may be a breaking update for some, see
http://bluebirdjs.com/docs/new-in-bluebird-3.html#3.0.1-update


# 2.7.0

ADDED keep alive necessary to keep IronMQ connection open.

Officially only supported on Node.js 4.0 or later.


# 2.6.0

CHANGED tests that schedule with interval now respect start time.

When scheduling a job to run every 24 hours, it will run at 0:00 starting on the
next day.

When scheduling a job to run every 24 hours from the start time.  Previously
this was not respected in the test suite.

This allows you to run a job every 24 hours at 5:00 by scheduling with:

{
  every: '24h',
  start: new Date(null, null, null, 5)
}


# 2.5.0

ADDED `resetSchedule` to help test scheduled jobs.


# 2.4.2

FIXED `runOnce` should continue to honor intervals after first run.


# 2.4.1

FIXED start time scheduling.


# 2.4.0

CHANGED when testing, you need to advance the clock to run a scheduled job.

For example:

```
Ironium.scheduleJob('daily', '24h', function(done) {
  console.log('Run daily job');
});
await Ironium.runOnce();
TimeKeeper.travel(Date.now() + ms('24h'));
await Ironium.runOnce();
=> Run daily job
```


# 2.3.10

FIXED sometimes errors during job handling go ignored.


# 2.3.9

FIXED do not swallow processing errors that have the same signature as
beanstalkd errors.


# 2.3.8

FIXED round up schedule to next interval.


# 2.3.7

FIXED pass jobID to error handler via domain.


# 2.3.6

FIXED should exit domain after running job handler.

FIXED show queue name / job ID for failed job.


# 2.3.5

FIXED automatically retry first failed attempt to queue job.


# 2.3.3

Updated dependencies.


# 2.3.2

FIXED bug in logging failed job.

# 2.3.1

CHANGED runOnce throws error, no need to log it as well.


# 2.3.0

ADDED configures itself from IRON_MQ_PROJECT_ID and IRON_MQ_TOKEN environment
variables (e.g. when running in Heroku)


# 2.2.0

CHANGED run all job handlers at once

ADDED log job processing time


# 2.1.0

FIXED keep server alive until stop()


# 2.0.1

FIXED race condition that causes write after end errors


# 2.0.0

REMOVED deprecated methods.

FIXED bug in purgeQueues.


# 1.2.4

Updated to Babel.js 4.7.1.


# 1.2.3

Updated to Babel.js 4.4.5.


# 1.2.2

FIXED trying to catch "write after" end errors.


# 1.2.1

Upgraded to 6to5 3.0.


# 1.2.0

ADDED support for queuing with streams.

For example, to queue all the jobs from the source stream, and log the queued
job IDs:

  source
    .pipe( queue.stream() )
    .pipe( process.stdout );

ADDED `queueJob` as alias for `pushJob` and `Ironium.queueJob` shortcut.

ADDED you can use queueJob, delayJob, etc without an object reference.

CHANGED switched from Traceur to 6to5, which works much better for 3rd party
libraries.


# 1.1.0

ADDED you can now use pushJob with a string or buffer; objects are always
serialized to JSON.

CHANGED push deprecated, use pushJob instead

CHANGED delay deprecated, use delayJob

CHANGED each deprecated, used eachJob instead

CHANGED schedule deprecated, use scheduleJob instead

CHANGED once deprecated, use runOnce instead

CHANGED reset deprecated, use purgeQueues instead

CHANGED width deprecated, use queueWidth instead


# 1.0.3

FIXED no longer user timeout to detect connection failure, this allows better
concurrency for job push on slow connections.


# 1.0.1

REMOVED "possible EventEmitter memory leak detected" message when we have
hundred of writers pushing to the same queue.


# 1.0.0

ADDED emit `error` events and output error message when `DEBUG=ironium`


# 0.13.0

ADDED when executing job, current job ID available from process.domain.jobID

Since the domain is accessible in callbacks and event handlers, you can use this
to trace the execution of the job, specifically for logging messages.


# 0.12.1

FIXED make sure to unref all timeout/interval.


# 0.12.0

ADDED Ironium will output to console if run with `DEBUG=ironium` or `DEBUG=*`.

ADDED The methods start, stop, once and reset are now bound to an instance of
Ironium, so can be passed directly to Mocha before/after methods.

REMOVED No longer emitting `error` events.


# 0.11.9

CHANGED zero timeouts and delay when running in development or test environments


# 0.11.8

FIXED stupid bug when fetching queued jobs


# 0.11.7

CHANGED just in case defensive programming at practice


# 0.11.6

Trying better handling when establishing connection


# 0.11.5

FIXED was testing error instead of message, incorrect in some envs


# 0.11.4

FIXED queue processing may stop for some rejected promises


# 0.11.3

FIXED properly detect error message


# 0.11.2

CHANGED ignore DRAINING error


# 0.11.1

CHANGED ignore connection closed error when processing queue


# 0.11.0

ADDED queue.delay works just like queue.push but delays processing of the job.

```
queue.delay(job, duration, callback?)
```

Duration is either a number or a string.  The default unit is milliseconds, but
you can specify a string with units, such as "5m" or "3 hours".

Valid units are `ms`, `seconds`, `minutes`, `hours`, `days` and `years`.  You
can write each unit as plural ("1 hours"), singular ("1 hour") or first letter
only ("1h").


# 0.10.3

FIXED generate error when one not available


# 0.10.2

FIXED error handling for sessions and reset


# 0.10.0

Because ES7, Ironium's API changed to return promises instead of thunks.

If you're using Traceur, and you wanted to duplicate a job in queue0 to queue1
and queue2, you could do this:

```
queue0.each(async function(job) {
  await queue1.push(job);
  await queue2.push(job);
});
```


# 0.9.15

Upgraded to Traceur 0.0.18.


# 0.9.14

FIXED: don't block $schedule queue waiting for jobs to run.


# 0.9.13

CHANGED: workers.once() fails if any scheduled job fails.

FIXED: if request to queue scheduled job fails, try again.


# 0.9.12

FIXED: scheduled jobs not processed until next schedule.


# 0.9.11

FIXED: don't care for close errors while reserving jobs.


# 0.9.10

FIXED: more informative close/error messages.


# 0.9.9

Upgraded to Traceur 0.0.10.


# 0.9.8

FIXED: should not warn about closed connection, unless it interrupts request.

CHANGED: schedule time should be ISO string.


# 0.9.7

CHANGED: session ID now indicates if it's put session or worker number.

FIXED: error handling for connection close/error without using timeout.

FIXED: trying to work around Iron.io disconnect issue.


# 0.9.6

CHANGED: documentation uses `ironium` instead of `workers`.

FIXED: connection errors not reported correctly.


# 0.9.5

FIXED: bug when cleaning out Beanstalkd queue.


# 0.9.4

CHANGED: use of queues on their own will not prevent process from completing.


# 0.9.3

FIXED: scheduled jobs not running in production.


# 0.9.2

FIXED: hostname/port not picked up from configuration.


# 0.9.1

Configuration gets separate section for setting up Iron.io server.


# 0.9.0

Scheduler now queues job for execution, this will allow using a scheduler
service.

Scheduler now accepts scheduled time as either Date, interval (number or
string), or an object with start time, end time and interval.


# 0.8.0

Methods like `once`, `reset` and `push` now return thunks instead of promises.
Disappointing for some, but easier for those of us using
[Mocha](http://visionmedia.github.io/mocha/) and
[co](https://github.com/visionmedia/co).


# 0.7.3

Testing with [Travis-CI](https://travis-ci.org/assaf/ironium).


# 0.7.2

Fixed: need Error object when reporting connection closed


# 0.7.1

Use [monolithed/ECMAScript-6](https://github.com/monolithed/ECMAScript-6) to
implement promises.


# 0.7.0

Removed `workers.fulfill`, please use
[thunks](https://github.com/visionmedia/co#thunks-vs-promises) instead.

Minor performance improvement.


# 0.6.0

Removed `workers.push` and `workers.each`, referencing queues is better for
testing.

Renamed count to width (number of workers used in parallel).

Tests!


# 0.5.3

Allow multiple queue handlers.

Added `workers.push`, `workers.each` and `workers.webhookURL` convenience
methods.


# 0.5.2

Using [co](https://github.com/visionmedia/co).


# 0.5.1

Added `workers.fulfill` to ease using generators with callbacks.

Added documentation for logging.


# 0.5.0

Preliminary support for generators.


# 0.4.0

Use native Promise instead of Q.
