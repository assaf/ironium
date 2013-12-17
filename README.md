**[Ironium](https://github.com/assaf/ironium)** A simple API for working with
job queues and scheduled jobs, using
[Beanstalkd](http://kr.github.io/beanstalkd/) and/or
[Iron.io](http://www.iron.io/).


## The Why

Because you've got workload that you want to run outside the Web app's
request/respose cycle, and you need job queues and/or scheduling.

[Beanstalkd](http://kr.github.io/beanstalkd/) is great for queuing and
processing jobs.  It's easy to setup (`brew install beanstalkd`), easy to test
with (at least with [Codeship](http://codeship.io/)), easy to tinker with
(Memcached-like text protocol), and persistently reliable.

There's also [Iron.io](http://www.iron.io/), a paid service that talks the
Beanstalkd protocol, so you can run tests against one, production against the
other.  Iron.io adds a nice management GUI, and can handle
[Webhooks](http://www.webhooks.org/) Webhooks for you.


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

Alternatively, the function can return a promise, in which case the job is
discarded when the promise resolved, or returned to the queue if the promise is
rejected.

For example:

```
workers.queue('delayed-echo').each(job) {
  var defered = new Promise();

  setTimeout(function() {
    console.log('Echo', job.message);
    promise.resolve();
  }, 5000);

  return promise;
});
```

You must use either callback or promise to indicate completion, and do so within
1 minute.  Jobs that don't complete within that time frame are considered to
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
grunt build  # Compile source files from src/ into lib/ directory
grunt watch  # Continously compile source files on every change
grunt clean  # Clean compiled files in lib/ directory
grunt        # Shortcut for grunt build watch
```

The tests are non-existent at the moment, but if they were to exist, you would
run them with `npm test` or `mocha`.

