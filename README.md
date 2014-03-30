# [Ironium](https://github.com/assaf/ironium)

![](https://rawgithub.com/assaf/ironium/master/element.svg)

Job queues and scheduled jobs for Node.js,
[Beanstalkd](http://kr.github.io/beanstalkd/) and/or
[Iron.io](http://www.iron.io/).

![](http://b.adge.me/npm/v/ironium.svg)
![](http://b.adge.me/npm/v/ironium.svg)
![](http://b.adge.me/:license-MIT-green.svg)


## The Why

You've got a workload that runs outside the Web app's request/response cycle.
Some jobs are queued, some are scheduled.  You decided to use Beanstalkd and/or
Iron.io.  Now you need a simple API to code against, that will handle all the
run-time intricacies for you.

[Beanstalkd](http://kr.github.io/beanstalkd/) is "a simple, fast work queue".
It's easy to setup (`brew install beanstalkd` on the Mac), easy to tinker with
(`telnet localhost 11300`), and persistenly reliable.

[Iron.io](http://www.iron.io/) is "the Message Queue for the Cloud".  It's a
managed queue service with a nice UI, an excellent choice for production
systems.  And can handle much of the [Webhooks](http://www.webhooks.org/)
workload for you.

The thing is, standalone Beanstalkd is great for development and testing, I just
don't want to manage a production server.  Iron.io is a wonderful service, but
you can't use it for development/testing.  Fortunately, they both speak the
Beanstalkd protocol.

**Ironium** lets you use both services, while taking care of all the pesky
details, like connection management and restart, timing out failed jobs,
retries, etc.

* **[API](#api)**
  * [queue(name)](#queuename)
  * [queue.push(job, callback)](#queuepushjob-callback)
  * [queue.each(handler)](#queueeachhandler)
  * [queue.name](#queuename)
  * [queue.webhookURL](#queuewebhookurl)
  * [schedule(name, time, job)](#schedulename-time-job)
  * [configure(object)](#configureobject)
  * [start()](#start)
  * [stop()](#stop)
  * [once(callback)](#oncecallback)
  * [reset(callback)](#resetcallback)
* **[Using Promises](#using-promises)**
* **[Using Generators](#using-generators)**
* **[Logging](#logging)**
* **[Configuring](#configuring)**
* **[Testing Your Code](#testing-your-code)**
* **[Contributing](#contributing)**


## API

Ironium has a simple API with three primary methods:
- `push` to push a job into a queue
- `each` to process all jobs from the queue
- `schedule` to run a job on a given schedule

There are a few more methods to help you with managing workers, running tests,
and working with Webhooks.


### queue(name)

Returns the named queue.  Calling this method with the same name will always
return the same queue.  Queues are created on-the-fly, you don't need to setup
anything before accessing a queue.

You can immediately push new jobs into the queue.  To process all jobs, you need
to first start the workers.  This distinction allows you to push jobs from any
Node.js servers, but only process jobs from specific nodes.

For example, your code may have:

```
var ironium          = require('ironium');
var sendWelcomeEmail = ironium.queue('send-welcome-email');

// If this is a new customer, queue sending welcome email.
customer.on('save', function(next) {
  if (this.isNew)
    sendWelcomeEmail.push(this.id, next);
  else
    next();
});

sendWelcomeEmail.each(function(id, callback) {
  // Do something to render and send email
  callback();
});

```

As you can see from this example, each queue has two interesting methods, `push`
and `each`.


### queue.push(job, callback)

Pushes a new job into the queue.  The job is serialized as JSON, so objects,
arrays and strings all work as expected.

If the second argument is a callback, it is called after the job has been queued.
Otherwise, returns a promise.

For example:

```
var job = {
  message: 'wow, such workers, much concurrency'
};

queues('echo').push(job, function(error) {
  if (error)
    console.error('No echo for you!');
});
```

Because this function returns a promise, you can also do this in your test suite:

```
before(()=> queues('echo').push(job));
```

And this, if you're using ES7:

```
await queues('echo').push(job);
```


### queue.each(handler)

Processes jobs from the queue. In addition to calling this method, you need to
either start the workers (see `start` method), or run all queued jobs once (see
[`once`](#oncecallback)).

The first argument is the job handler, a function that takes either one or two
arguments.  The second argument is the number of workers you want processing the
queue, you can set this for each queue, or for all queues in the configuration
file.

The first argument is the job, a JavaScript object or primitive.  The second
argument is a callback that you must call when the job completes, to discard the
job.  If you call with an error, the error is logged and the job returns to the
queue, from where it will be picked up after a short delay.

For example:

```
ironium.queue('echo').each(function(job, callback) {
  console.log('Echo', job.message);
  callback();
});
```

Alternatively, the function can return a promise or a generator.  We discuss
promises and generators later on.  For example:

```
ironium.queue('echo').each(async function(job) {
  console.log('Echo', job.message);
  await fnReturningPromise();
  await anotherAsyncFunction();
  return;
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

```
var QS = require('querystring');

ironium.queue('webhook').each(function(job, callback) {
  var params = QS.parse(job);
  console.log(params.message);
  callback();
});
```

### queue.name

This property returns the queue name.

This name does not include the prefix.

### queue.webhookURL

This method / property returns the Webhook URL.  Only available when using
Iron.io.  You can pass this URL to a service, and any messages it will post to
this URL will be queued.


### schedule(name, time, job)

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

Just like a queued job, the scheduled job is called with a callback and must use
it to report completion.  However, it may also return a promise, or be a
generator function.

For example:

```
ironium.schedule('everyHour', '1h', function(callback) {
  console.log("I run every hour");
});

ironium.schedule('inAnHour', new Date() + ms('1h'), function() {
  console.log("I run once, after an hour");
  return Promise.resolve();
});

var schedule = {
  every: ms('2h'),               // Every two hours
  end:   new Date() + ms('24h'), // End in 24 hours
};
ironium.schedule('everyTwoForADay', schedule, async function() {
  console.log("I run every 2 hours for 24 hours");
  var customers = await Customer.findAll();
  for (var customer of customers)
    await customer.increase('awesome');
});
```


### configure(object)

Configure the workers, see [Configuring](#configuring).


### start()

You must call this method to start the workers.  Until you call this method, no
scheduled or queued jobs are processed.

The `start` method allows you to run the same codebase in multiple environments,
but only enable processing on select servers.  For testing, have a look at `once`.


### stop()

You can call this method to stop the workers.


### once(callback)

Use this method when testing.  It will run all schedules jobs exactly once, and
then process all queued jobs until the queues are empty.

You can either call `once` with a callback, to be notified when all jobs have
been processed, or with no arguments, it will return a promise.

This method exists since there's no reliable way to use `start` and `stop` for
running automated tests.

For example:

```
var queue = ironium.queue('echo');
var echo  = [];

// Scheduled worker will queue a job
ironium.schedule('echo-foo', '* * * *', function(callback) {
  queue.push('foo', callback);
});

queue.each(function(text, callback) {
  echo.push(text);
  callback();
});

// Queue another job
before(()=> queue.push('bar'));

// Running the scheduled job, followed by the two queued jobs
before(()=> ironium.once());

it("should have run the foo scheduled job", function() {
  assert(echo.indexOf('foo') >= 0);
});

it("should have run the bar job", function() {
  assert(echo.indexOf('bar') >= 0);
});
```

### reset(callback)

Use this method when testing.  It will delete all queued jobs.

You can either call `reset` with a callback, to be notified when all jobs have
been deleted, or with no arguments, returns a promise.

For example:

```
before(()=> ironium.reset());
```

Is equivalent to:

```
before(function(done) {
  ironium.reset(done);
});
```


## Using Promises

If you prefer, your jobs can return
[promises](http://www.html5rocks.com/en/tutorials/es6/promises/) instead of
using callbacks.  The job is considered complete when the promise resolves, and
failed if the promise gets rejected.  In the case of queues, the failed job will
return to the queue and processed again.

For example:

```
ironium.queue('delayed-echo').each(function(job) {
  var promise = new Promise(function(resolve, reject) {

    console.log('Echo', job.message);
    resolve();

  });
  return promise;
});
```


## Using Generators

Jobs that have multiple steps can also use generators in combination with
promises and callback.  At each step the job can yield with a promise, and act
on the value of that promise.  For example:

```
ironium.queue('update-name').each(function(job) {
  var customer = yield Customer.findById(job.customerID);

  // At this point customer is set
  customer.set('firstName', job.firstName);
  customer.set('lastName',  job.lastName);
  assert(customer.isModified());

  yield customer.save();
  // Customer has been saved in the database
  assert(!customer.isModified());
});
```

If you need to use callbacks, you can return a
[thunk](https://github.com/visionmedia/co#thunks-vs-promises).  A `thunk` is a
function that receives a callback, but no other arguments.

For example, Mongoose finders return promises, but the save method doesn't, so
you'll need to write your code like this:


```
ironium.queue('update-name').each(function*(job) {
  // You must call exec() to turn query into a promise
  var customer = yield Customer.findById(job.customerID).exec();

  // At this point customer is set
  customer.set('firstName', job.firstName);
  customer.set('lastName',  job.lastName);
  assert(customer.isModified());

  // customer.save needs a callback, yields needs a promise
  yield function(callback) {
    customer.save(callback);
  };
  // Customer has been saved in the database
  assert(!customer.isModified());
});
```

Another example:

```
ironium.queue('echo-file').each(function*(job) {
  var contents = yield function(callback) {
    File.readFile(job.filename, callback);
  };
  console.log(contents);
});
```


## Logging

Don't work blind!  There are three events you can listen to:

`error` - Emit errors from failed jobs
`info`  - Logs job getting processed and successful completion
`debug` - Way more information, useful for troubleshooting

For example:

```
if (process.env.DEBUG)
  ironium.on('debug', function(message) {
    console.log(message);
  });

ironium.on('info', function(message) {
  console.log(message);
});

ironium.on('error', function(error) {
  console.error(error.stack);
  errorService.notify(error);
});
```


## Configuring

For development and testing you can typically get by with the default
configuration.  For production, you may want to set the server in use, as simple
as passing a configuration object to `ironium.configure`:

```
var ironium = require('ironium');

if (process.env.NODE_ENV == 'production')
  ironium.configure({
    queues: {
      hostname: 'my.beanstalkd.server',
      width:    4
    }
  });
```

Or load it form a JSON configuration file:

```
var ironium = require('ironium');
var config  = require('./ironium.json');

if (process.env.NODE_ENV == 'production')
  ironium.configure(config);
```

The configuration options are:

```
{
  "queues": {
    "prefix":      <Prefix all queue names>,
    "width":       <Number of workers processing each queue, default to 1>,
    "hostname":    <Beanstalkd server hostname, default to localhost>,
    "port":        <Beanstalkd port number, default to 11300>
  },
  "scheduler": {
  },
  "ironio": {
    "hostname":    <Iron.io hostname, optional>,
    "projectID":   <project ID from credentials settings>,
    "token":       <access token for this project>
  }
}
```

If you're running in development or test environment with a local Beanstalkd
server, you can just use the default configuration, which points to `localhost`,
port 11300.

The default configuration when running in test environment (`NODE_ENV ==
'test'`) uses the prefix `test-` for all queues.

If you're running in production against a Beanstalkd, you will likely need to
set `queues.hostname` and `queues.port`.

If you're running in production against an [Iron.io](https://hud.iron.io/), you
need to set `ironio.projectID` and `ironio.token` based on your project
credentials.  You may set `ironio.hostname`, or just rely on the default.

When using Iron.io, the `queues.hostname` and `queues.port` are ignored.


## Testing Your Code

The default test configuration (`NODE_ENV == 'test'`) connects to Beanstalkd on
localhost, and prefixes all queue names with `test-`, so they don't conflict
with any queues used during development.

[Codeship](http://codeship.io/) has Beanstalkd installed on test servers, if
using [Travis-CI](https://travis-ci.org), you will need to install if
specifically, see out [`.travis.yml`](.travis.yml).


## Contributing

Ironium is written in ECMAScript 6, because future.

The ES6 source lives in the `src` directory, compiled into ES5 in the `lib`
directory.  We use [Gulp.js](http://gulpjs.com/) for the convenience plugins of
compiling, watching and notifying.

Specifically:

```
gulp          # Run this in development, continously compiles on every change
gulp build    # Compile source files from src/ into lib/
gulp clean    # Clean compiled files
gulp release  # Publish new release
```

You can run the entire test suite with `npm test`
([Travis](https://travis-ci.org/assaf/ironium) runs this), or specific
files/tests with [Mocha](http://visionmedia.github.io/mocha/).

