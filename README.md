# [Ironium](https://github.com/assaf/ironium)

Job queues and scheduled jobs for Node.js,
[Beanstalkd](http://kr.github.io/beanstalkd/) and/or
[Iron.io](http://www.iron.io/).


## The Why

You've got a workload that runs outside the Web app's request/response cycle.
Some jobs are queued, some are scheduled.  You decided to use Beanstalkd and/or
Iron.io.  Now you need a simple API to code against, that will handle all the
run-time intricacies for you.

[Beanstalkd](http://kr.github.io/beanstalkd/) is "a simple, fast work queue".
It's easy to setup (`brew install beanstalkd` on the Mac), easy to tinker with
(`telnet localhost 11300`), and persistenly reliable.  And it's available on
[Codeship](http://codeship.io/), our preferred CI service.

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


## The How

Ironium has a simple API with three primary methods:
- `push` to push a job into a queue
- `each` to process all jobs from the queue
- `schedule` to run a job on a given schedule

There are a few more methods to help you with managing workers, running tests,
and working with Webhooks.


#### queue(name)

Returns the named queue.  Calling this method with the same name will always
return the same queue.  Queues are created on-the-fly, you don't need to setup
anything before accessing a queue.

You can immediately push new jobs into the queue.  To process all jobs, you need
to first start the workers.  This distinction allows you to push jobs from any
Node.js servers, but only process jobs from specific nodes.

For example, your code may have:

```
var workers          = require('ironium');
var sendWelcomeEmail = workers.queue('send-welcome-email');

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


#### queue.push(job, callback?)

Pushes a new job into the queue.  The job is serialized as JSON, so objects,
arrays and strings all work as expected.

If the second argument is a callback, called after the job has been queued.
Otherwise, returns a promise that resolves when the job has been queued. 

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


#### queue.each(handler, workers?)

Processes jobs from the queue. In addition to calling this method, you need to
either start the workers (see `start` method), or run all queued jobs (see
`once` method).

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
workers.queue('echo').each(job, callback) {
  console.log('Echo', job.message);
  callback();
});
```

Alternatively, the function can return a promise or a generator.  We discuss
promises and generators later on.


You must use either callback or promise to indicate completion, and do so within
10 minutes.  Jobs that don't complete within that time frame are considered to
have failed, and returned to the queue.  Timeouts are necessary evil, given that
jobs may fail to report completion and the halting problem is still NP hard.

If a failed job is returned to the queue, it will go into the 'delayed' state
and stay there for a few minutes, before it can be picked up again.  This delay
prevents processing bugs and transient errors (e.g. connection issues) from
resulting in a DoS attack on your error log.

When processing Webhooks, some services send valid JSON object, other services
send text strings, so be ready to process those as well.  For example, some
services send form encoded pairs, so you may need to handle them like this:

```
var QS = require('querystring');

workers.queue('webhook').each(function(job, callback) {
  var params = QS.parse(job);
  console.log(params.message);
  callback();
});
```

#### queue.name

This property returns the queue name.

This name does not include the prefix.

#### queue.webhookURL

This property returns the Webhook URL.  Only available when using Iron.io.  You
can pass this URL to a service, and any messages it will post to this URL will
be queued.


#### schedule(name, time, job)

TBD Schedules the named job to run at the given schedule.


#### configure(object)

Configure the workers (see below).


#### start()

You must call this method to start the workers.  Until you call this method, no
scheduled or queued jobs are processed.

The `start` method allows you to run the same codebase in multiple environments,
but only enable processing on select servers.  For testing, have a look at `once`.


#### stop()

You can call this method to stop the workers.


#### once(callback?)

Use this method when testing.  It will run all schedules jobs exactly once, and
then process all queued jobs until the queues are empty.

You can either call `once` with a callback, to be notified when all jobs have
been processed, or with no arguments and wait on the promise it returns.

This method exists since there's no reliable way to use `start` and `stop` for
running automated tests.

For example:

```
var queue = workers.queue('echo');
var echo  = [];

// Scheduled worker will queue a job
workers.schedule('echo-foo', '* * * *', function(callback) {
  queue.push('foo', callback);
});

before(function(done) {
  // Queue another job
  queue.push('bar', done);
});

before(function(done) {
  queue.each(function(text, callback) {
    echo.push(text);
    callback();
  });

  // Running the scheduled job, followed by the two queued jobs
  workers.once(done);
});

it("should have run the foo scheduled job", function() {
  assert(echo.indexOf('foo') >= 0);
});

it("should have run the bar job", function() {
  assert(echo.indexOf('bar') >= 0);
});
```

#### fulfill(fn)

Calls the function with a callback that fulfills a promise, returns that
promise.

Use this with yield expressions to wrap a function that takes a callback, and
yield its promise.  For example:

```
var contents = yield workers.fulfill(function(callback) {
  File.readFile(filename, callback);
});
```


#### reset(callback)

Use this method when testing.  It will delete all queued jobs.

You can either call `reset` with a callback, to be notified when all jobs have
been deleted, or with no arguments and wait on the promise it returns.

For example:

```
before(function(done) {
  promise = workers.reset();
  promise.then(done, done);
});
```


## Using Promises

If you prefer, your jobs can return promises instead of using callbacks.  The
job is considered complete when the promise resolves, and failed if the promise
gets rejected.  In the case of queues, the failed job will return to the queue
and processed again.

For example:

```
workers.queue('delayed-echo').each(function(job) {
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
workers.queue('update-name').each(function(job) {
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

If you need to use callbacks, you can call `workers.fulfill()` to get a promise,
and run code with a callback that fulfills that promise.

For example, Mongoose finders return promises, but the save method doesn't, so
you'll need to write your code like this:

```
workers.queue('update-name').each(function* updateName(job) {
  // You must call exec() to turn query into a promise
  var customer = yield Customer.findById(job.customerID).exec();

  // At this point customer is set
  customer.set('firstName', job.firstName);
  customer.set('lastName',  job.lastName);
  assert(customer.isModified());

  // customer.save needs a callback, yields needs a promise
  yield workers.fulfill(function(callback) {
    customer.save(callback);
  });
  // Customer has been saved in the database
  assert(!customer.isModified());
});
```

Another example:

```
workers.queue('echo-file').each(function* writeFile(job) {
  var contents = yield workers.fulfill(function(callback) {
    File.readFile(job.filename, callback);
  });
  console.log(contents);
});
```


## Logging

Don't work blind!  There are three events you can listen to:

`error` - Emitted on any error (processing job, connection, etc)
`info`  - Logs job getting processed and successful completion
`debug` - Way more information, useful for troubleshooting

For example:

```
if (process.env.DEBUG)
  workers.on('debug', function(message) {
    console.log(message);
  });

workers.on('info', function(message) {
  console.log(message);
});

workers.on('error', function(error) {
  console.error(error.stack);
  errorService.notify(error);
});
```


## Configurations

For development and testing you can typically get by with the default
configuration.  For production, you may want to set the server in use, as simple
as passing a configuration object to `workers.configure`:

```
var workers = require('ironium');

if (process.env.NODE_ENV == 'production')
  workers.configure({
    queues: {
      hostname: 'my.beanstalkd.server'
    }
  });
```

Or load it form a JSON configuration file:

```
var workers = require('ironium');
var config  = require('./workers.json');

if (process.env.NODE_ENV == 'production')
  workers.configure(config);
```

The configuration options are:

* `queues.hostname`   - Hostname of the queue server (defaults to `localhost`)
* `queues.port`       - Port number for the queue server (defaults to 11300)
* `queues.prefix`     - Prefix all queue names (when `NODE_ENV == test`,
  defaults to `test-`)
* `queues.token`      - When using Iron.io, the API token (get it from the
  project's credentials page)
* `queues.projectID`  - When using Iron.io, the API project ID (get it from the
  project's credentials page)
* `queues.workers`    - Number of workers processing each queue (default to 1)

If you're running in development or test environment with a local Beanstalkd
server, you can use the default configuration, which points to `localhost` port
`11300` and uses the prefix `test-` in test envrionment.

If you're running in production against a Beanstalkd, you will likely need to
set the hostname and port number.

If you're running in production against an [Iron.io](https://hud.iron.io/)
server, you will need to set the hostname to `"mq-aws-us-east-1.iron.io"`, and
set the `token` and `projectID` based on the Iron.io project's credentials.


## Contributing

Ironium is written in ECMAScript 6, because future.  Specifically you'll notice
that `let` and `const` replaced all usage of `var`, class definitions are
easier to read in the new syntax, and fat arrows (`=>`) replace `that = this`.

However, the code doesn't depend on any of the new ES6 libraries (`Map`, `find`,
etc), since these can only be added to the global namespace, which would be bad,
bad, bad.  We use [lodash](http://lodash.com/) instead.

The ES6 source lives in `src` and gets compiled into ES5 legacy in `lib`.  And
[Grunt](http://gruntjs.com/) because it has good support for watched compiling
and OS X notifying.

Specifically:

```
grunt         # Run this in development (same as grunt build watch)
grunt build   # Compile source files from src/ into lib/ directory
grunt watch   # Continously compile source files on every change
grunt clean   # Clean compiled files in lib/ directory
grunt release # Publish new release (also grunt release:minor/major)
```

The tests are non-existent at the moment, but if they were to exist, you would
run them with `npm test` or `mocha`.

