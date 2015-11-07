# [Ironium](https://www.npmjs.com/package/ironium)

Job queues and scheduled jobs for Node.js, Beanstalkd and IronMQ.

![](https://rawgithub.com/assaf/ironium/master/element.svg)


## The Why

You've got a workload that runs outside the Web app's request/response cycle.
Some jobs are queued, some are scheduled.  You decided to use Beanstalkd and/or
IronMQ.  Now you need a simple API to code against, that will handle all the
run-time intricacies for you.

[Beanstalkd](http://kr.github.io/beanstalkd/) is "a simple, fast work queue".
It's easy to setup (`brew install beanstalkd` on the Mac), easy to tinker with
(`telnet localhost 11300`), and persistently reliable.

[IronMQ](http://www.iron.io/) is "the Message Queue for the Cloud".  It's a
managed queue service with a nice UI, an excellent choice for production
systems.  And can handle much of the [Webhooks](http://www.webhooks.org/)
workload for you.

The thing is, standalone Beanstalkd is great for development and testing, I just
don't want to manage a production server.  IronMQ is a wonderful service, but
painful to use for development/testing.

Ironium allows you to use either/both in the same project.


* **[API](#api)**
  * [queue(name)](#queuename)
  * [queueJob(name, job)](#queuejobname-job)
  * [queue.queueJob(job)](#queuejobname-job)
  * [queue.delayJob(job, duration)](#queuedelayjobjob-duration)
  * [queue.eachJob(handler)](#queueeachjobhandler)
  * [queue.stream()](#queuestream)
  * [queue.name](#queuename)
  * [webhookURL](#webhookurl)
  * [scheduleJob(jobName, when, handler)](#schedulejobjobname-when-handler)
  * [configure(object)](#configureobject)
  * [start()](#start)
  * [stop()](#stop)
  * [resetSchedule()](#resetschedule)
  * [runOnce()](#runonce)
  * [purgeQueues()](#purgequeues)
* **[Using Promises](#using-promises)**
* **[Async/Await](#asyncawait)**
* **[Logging](#logging)**
* **[Configuring](#configuring)**
* **[Testing Your Code](#testing-your-code)**
* **[Contributing](#contributing)**


## API

Ironium has a simple API with three primary methods:
- `queueJob` to push a job into a queue
- `eachJob` to process all jobs from the queue
- `scheduleJob` to run a job on a given schedule

There are a few more methods to help you with managing workers, running tests,
and working with Webhooks.


### queue(queueName)

Returns the named queue.  Calling this method with the same name will always
return the same queue.  Queues are created on-the-fly, you don't need to setup
anything before accessing a queue.

You can immediately push new jobs into the queue.  To process all jobs, you need
to first start the workers.  This distinction allows you to push jobs from any
Node.js servers, but only process jobs from specific nodes.

For example, your code may have:

```javascript
const ironium          = require('ironium');
const sendWelcomeEmail = ironium.queue('send-welcome-email');

// If this is a new customer, queue sending welcome email.
customer.on('save', function(next) {
  if (this.isNew)
    sendWelcomeEmail.queueJob(this.id, next);
  else
    next();
});

sendWelcomeEmail.eachJob(function(id, callback) {
  // Do something to render and send email
  callback();
});

```

As you can see from this example, each queue has three interesting methods,
`queueJob`, `delayJob` and `eachJob`.


### queueJob(queueName, job)
### queue.queueJob(job)

Pushes a new job into the queue.  The job is serialized as JSON, so objects,
arrays and strings all work as expected.

Returns a promise that resolves to the job ID.

Calling `Ironium.queueJob(name, job)` is the same as
`Ironium.queue(name).queueJob(job)`.

For example:

```javascript
const echoQueue = ironium.queue('queue');

const job = {
  message: 'wow, such workers, much concurrency'
};

echoQueue.queueJob(job, function(error) {
  if (error)
    console.error('No echo for you!');
});
```

Because this function returns a promise, you can also do this in your test suite:

```javascript
before(()=> echoQueue.queueJob(job));
```

And this, if you're using ES7:

```javascript
await echoQueue.queueJob(job);
```


### queue.delayJob(job, duration)

Similar to [`queueJob`](#queuequeuejobjob) but delays processing of the
job by the set duration.

Duration is either a number or a string.  The default unit is milliseconds, but
you can specify a string with units, such as "5m" or "3 hours".

Valid units are `ms`, `seconds`, `minutes`, `hours`, `days` and `years`.  You
can write each unit as plural ("1 hours"), singular ("1 hour") or first letter
only ("1h").


### eachJob(queueName, handler)
### queue.eachJob(handler)

Processes jobs from the queue. In addition to calling this method, you need to
either start the workers (see `start` method), or run all queued jobs once (see
[`runOnce`](#runonce)).

The job handler is a function that takes either one or two arguments.  The first
argument to the job handler is the job itself, a JavaScript object or primitive.

The job handler can return a promise that resolves when the job
completes, or a generator function.  Alternatively, it can inform a callback.
The second argument to the job handler is that callback.

For example:

```javascript
ironium.queue('echo').eachJob(async function(job) {
  console.log('Echo', job.message);
  await fnReturningPromise();
  await anotherAsyncFunction();
  return;
});
```

Or using callbacks:

```javascript
ironium.queue('echo').eachJob(function(job, callback) {
  console.log('Echo', job.message);
  callback();
});
```

You must use either callback, resolve promise, or return from generator to
indicate completion, and do so within 10 minutes.  Jobs that don't complete
within that time frame are considered to have failed, and returned to the queue.
Timeouts are necessary evil, given that jobs may fail to report completion and
the halting problem is still NP hard.

If a failed job is returned to the queue, it will go into the 'delayed' state
and stay there for a few minutes, before it can be picked up again.  This delay
prevents processing bugs and transient errors (e.g. connection issues) from
resulting in a DoS attack on your error log.

You can attach multiple handlers to the same queue, and each job will go to all
the handlers.  If any handler fails to process the job, it will return to the
queue.

When processing Webhooks, some services send valid JSON object, other services
send text strings, so be ready to process those as well.  For example, some
services send form encoded pairs, so you may need to handle them like this:

```javascript
const QS = require('querystring');

ironium.queue('webhook').eachJob(function(job, callback) {
  const params = QS.parse(job);
  console.log(params.message);
  callback();
});
```

### queue.stream()

You can use this to queue jobs from a Node stream.  It returns a duplex stream
to which you can write a stream of jobs, and read back a stream of job IDs.

For example:

```javascript
source
  .pipe( queue.stream() )
  .pipe( process.stdout );
```

### queue.name

This property returns the queue name.

This name does not include the prefix.

### webhookURL(queueName)

This method resolves to the Webhook URL of the named queue.

Since configuration can load asynchronously, this method returns a promise, not
the actual URL.  The webhook URL only makes sense when using IronMQ, beanstalkd
does not support this feature.

NOTE: The webhook URL includes your project ID and access token, so be careful
where you share it.


### scheduleJob(jobName, when, handler)

Schedules the named job to run at the specified time.

Each schedule has a unique name, this is used for reporting, and to prevent
accidental duplicate schedules.  However, you can create two schedules using the
same job.

The scheduled time can be a `Date`, in which case the job will run once at the
given time.  It can be an interval, in which case the job will run repeatedly at
the given interval.  The interval can be number (in ms), or a string that can
takes the form of "30s", "5m", "4h", etc.

The scheduled time can also be an object with the properties `start`, `end` and
`every`.  If the property `every` is specified, the job will run every so many
milliseconds.

If the property `start` is specified, the job will run once at the specified
time, and if `every` is also specified, repeatedly afterwards.  If the property
`end` is specified, the job will stop running after that time.

Just like a queued job, the scheduled job is expected to return a promise that
resolves on completion, or a generator function, or inform a callback.

For example:

```javascript
ironium.scheduleJob('inAnHour', new Date() + ms('1h'), function() {
  console.log("I run once, after an hour");
  return Promise.resolve();
});

ironium.scheduleJob('everyHour', '1h', function(callback) {
  console.log("I run every hour");
  callback();
});

const schedule = {
  every: ms('2h'),               // Every two hours
  end:   new Date() + ms('24h'), // End in 24 hours
};
ironium.scheduleJob('everyTwoForADay', schedule, async function() {
  console.log("I run every 2 hours for 24 hours");
  const customers = await Customer.findAll();
  for (var customer of customers)
    await customer.increase('awesome');
});
```


### configure(object | promise)

Configure the workers, see [Configuring](#configuring).


### start()

You must call this method to start the workers.  Until you call this method, no
scheduled or queued jobs are processed.

The `start` method allows you to run the same codebase in multiple environments,
but only enable processing on select servers.  For testing, have a look at
`runOnce`.


### stop()

You can call this method to stop the workers.


### resetSchedule()

Reset the next run time for all scheduled jobs.  Used during testing when
changing the system clock to test scheduled jobs, in particular, rewinding the
clock.

```javascript
Ironium.scheduleJob('every-night', '24h', runEveryNight);

TimeKeeper.travel('2015-06-30T15:00:00Z');
Ironium.resetSchedule();
// Job now scheduled for 7/1 00:00 because it will run every 24 hours,
// starting at 00:00 on the next day

Ironium.runOnce(); // Nothing happens

TimeKeeper.travel('2015-07-01T00:00:00Z');
Ironium.runOnce();
// Job runs once, now scheduled for 7/2 00:00

TimeKeeper.travel('2015-06-30T15:00:00Z');
Ironium.runOnce();
// Nothing happens because next run is 7/2

Ironium.resetSchedule();
// Job now scheduled for 7/1 00:00 again
```


### runOnce()

Use this method when testing.  It will run all schedules jobs, and then process
all queued jobs until the queues are empty.

Returns a promise that resolves when all jobs have been processed.

This method exists since there's no reliable way to use `start` and `stop` for
running automated tests.

With regards to scheduled jobs, each job has a schedule when it will run next.
Calling `runOnce` will run that job if its time has come.  It will also adjust
the next time the job should run.  You may also need to use
[resetSchedule](#resetschedule).

For example:

```javascript
const queue = Ironium.queue('echo');
const echo  = [];

Ironium.scheduleJob('echo-foo', '24h', function() {
  return queue.queueJob('foo');
});

queue.eachJob(function(text, callback) {
  echo.push(text);
  callback();
});


before(function() {
  TimeKeeper.travel('2015-06-30T12:00:00Z');
  Ironium.resetSchedule();
  // Job now scheduled for 7/1 at 00:00
});

// Queue another job
before(function() {
  return queue.queueJob('bar');
});

before(function() {
  // Running the scheduled job, followed by the two queued jobs
  TimeKeeper.travel(ms('2hr'));
  // Returns a promise, Mocha will wait for it to resolve
  return Ironium.runOnce();
});

it("should have run the foo scheduled job", function() {
  assert(echo.indexOf('foo') >= 0);
});

it("should have run the bar job", function() {
  assert(echo.indexOf('bar') >= 0);
});

after(function() {
  TimeKeeper.reset();
  Ironium.resetSchedule();
});
```

### purgeQueues()

Use this method when testing.  It will delete all queued jobs.

Returns a promise that resolves when all jobs have been deleted.

For example:

```javascript
before(ironium.purgeQueues);
```

Is equivalent to:

```javascript
before(function() {
  return ironium.purgeQueues();
});
```

**Note:** Mocha before/after runners accept functions that return a promise.
This is the case for the methods `start`, `stop`, `runOnce` and `purgeQueues`.
In addition, since these methods are bound to an instance of Ironium, you can
pass the method directly as an argument to `before` or `after`.


## Using Promises

If you prefer, your jobs can return
[promises](http://www.html5rocks.com/en/tutorials/es6/promises/) instead of
using callbacks.  The job is considered complete when the promise resolves, and
failed if the promise gets rejected.  In the case of queues, the failed job will
return to the queue and processed again.

For example:

```javascript
ironium.queue('delayed-echo').eachJob(function(job) {
  return Bluebird.delay(500)
    .then(function() {
      console.log('Echo', job.message);
    });
});
```


## Async/Await

This option is available when using [Babel JS](https://babeljs.io/), and allows
you to write code like this:

```javascript
ironium.queue('update-name').eachJob(async function(job) {
  const customer = await Customer.findById(job.customerID).exec();

  // At this point customer is set
  customer.firstName = job.firstName;
  customer.lastName  = job.lastName;
  assert(customer.isModified());

  await customer.savePromise();

  // Customer has been saved in the database
  assert(!customer.isModified());
});
```

An [`async
function`](http://wiki.ecmascript.org/doku.php?id=strawman:async_functions) is a
function that returns a promise.  Ironium will wait for the promise to resolve,
before marking the job as complete, and will retry the job if the promise fails.


An `await` expression waits for a promise to resolve.  In this example,
`findById(job.customerID).exec()` returns a promise that resolves to a customer
record (this is an actual [Mongoose API](http://mongoosejs.com/docs/api.html)).


## Logging

By default Ironium produces no messages to the console.  You can ask it to log
to the console by setting the `DEBUG` environment variable to `ironium` or
`ironium:*` (for more information, see
[debug](https://github.com/visionmedia/debug)).

For example:

```bash
# See processing errors
DEBUG=ironium npm start
# See queues and scheduling activity
DEBUG=ironium:queues,ironium:schedules npm start
# Everything
DEBUG=ironium:* npm start
```

In addition, you can register a callback to be notified of job processing
errors:

```javascript
ironium.onerror(function(error, subject) {
  console.error('Error reported by', subject);
  console.error(error.stack);
});
```

Because Ironium expects some jobs will fail, and will retry them until
successful, you do not have to listen to its `error` event.  It's error event
will not cause the program to exit.


## Configuring

For development and testing you can typically get by with the default
configuration.  For production, you may want to set the server in use, as simple
as passing a configuration object to `ironium.configure`:

```javascript
const ironium = require('ironium');

if (process.env.NODE_ENV == 'production')
  ironium.configure({
    host: 'my.beanstalkd.server'
  });
```

Or load it form a JSON configuration file:

```
const ironium = require('ironium');
const config  = require('./iron.json');

if (process.env.NODE_ENV == 'production')
  ironium.configure(config);
```

You can also use a promise that resolves to an object with all configuration
properties.

The configuration options are:

```
{
  "host":         <hostname, optional>,
  "project_id":   <project ID from credentials settings>,
  "token":        <access token for this project>,
  "prefix":       <Prefix all queue names>
}
```

If you're running in development or test environment with a local Beanstalkd
server, you can just use the default configuration, which points to `localhost`,
port 11300.

The default configuration when running in test environment (`NODE_ENV ==
'test'`) uses the prefix `test-` for all queues.

If you're running in production against a Beanstalkd, you will likely need to
set `queues.host` and `queues.port`.

If you're running in production against an [Iron.io](https://hud.iron.io/), you
need to set `host`, `project_id` and `token` based on your project credentials.
This is the same format as `iron.json`.


## Testing Your Code

The default test configuration (`NODE_ENV == 'test'`) connects to Beanstalkd on
localhost, and prefixes all queue names with `test-`, so they don't conflict
with any queues used during development.

[Codeship](http://codeship.io/) has Beanstalkd installed on test servers, if
using [Travis-CI](https://travis-ci.org), you will need to install if
specifically, see out [`.travis.yml`](.travis.yml).


## Contributing

Ironium is written in ECMAScript 6, because future.

You can run the entire test suite with `npm test`
([Travis](https://travis-ci.org/assaf/ironium) runs this), or specific
files/tests with [Mocha](http://visionmedia.github.io/mocha/).

