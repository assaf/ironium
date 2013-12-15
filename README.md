**[Ironium](https://github.com/assaf/ironium)** A simple API for working with
job queues and scheduled jobs, using
[Beanstalkd](http://kr.github.io/beanstalkd/) and/or
[Iron.io](http://www.iron.io/).


## The Why

Building a modern Web application involves a lot of workload that runs outside
the application request/response cycle.

Some tasks take a long time to complete (e.g. updating 3rd party APIs), and you
want to run after you've sent the response back to the user.  But since you send
back a response, you better get the task to complete, by retrying if necessary.

This is where job queues become useful:
- They can distribute the workload over multiple servers, and in time
- They can smooth out transient errors by retrying every joy
- They can be used for jobs queued by the application and 3rd party
  ([Webhooks](http://www.webhooks.org/))

Since high quality job queues exists, might as well use them.  One option is
[Beanstalkd](http://kr.github.io/beanstalkd/) which is easy to install and use,
and battle tested.

Another option is [Iron.io](http://www.iron.io/), a paid service that supports
the same API and can be used interchangeable with Beanstalkd.  This allows you
to use Beanstalkd for development/testing, and Iron.io for production instances.
Besides managed up-time and a management GUI, Iron.io can also handle Webhooks
(sending and receiving updates) for you.


## The How

Ironium has a simple API that exposes three primary methods:
- `push` a job into a queue
- `each` to process each job from a queue
- `schedule` a job to run at given schedule

There's more than that, so let's explore it.  The main object provides access to
all the workers, and in particular has the following methods:


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

#### queue.push(job, callback)

Pushes a new job into the queue.  The job can be any JavaScript value that
serializes into JSON, so object, arrays, string are all usable.

If you call `push` with a callback, the callback will be notified after the job
has been successfully added to the queue.  Use this to make sure the job is
queued before proceeding.

#### queue.each(fn)

Processes each job from the queue.  The function is called with two arguments,
the job (see `push` above) and a callback.  You must call that callback when
done processing the job.

If you call the callback with an error, the job is considered to have failed, is
put back in the queue, and will be picked up again after a 1 minute delay.

If you don't call the callback within a minute, the job will be considered to
have failed, and will be put back in the queue as well.

If one minute of processing doesn't sound like enough, consider breaking large
jobs into smaller chunks.  Also consider that time-outs are a necessary evil,
given the likelihood of a bug resulting in jobs that never complete, and the
halting problem being NP hard.

#### queue.name

The queue name (property, not a method).  This name does not include the prefix.

#### queue.webhookURL

The URL for recieving Webhook requests and queuing them, using Iron.io.  This
URL is only valid if your configured the workers with a project ID and token.


#### schedule(name, time, job)

TBD Schedules the named job to run at the given schedule.


#### configure(object)

Configure the workers (see below).


#### start()

You must call this method to start the workers.  Jobs can be queued, but will
not be processed until the workers are started.

This extra space allows you to load the same code in every environment, and
queue jobs on any server, but only process jobs on dedicated worker servers.


#### stop()

You can call this method to stop the workers.


#### once(callback)

Use this when testing.  It will run all scheduled jobs exactly once (regardless
of schedule), process all queued jobs, and finally call the callback.

This method exists since you cannot reliably pair `start` and `stop`.


#### reset(callback)

Use this when testing (setup and/or teardown).  It will delete all queued jobs,
then call the callback.



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
* `queues.projectID`  -  When using Iron.io, the API project ID (get it from the
  project's credentials page)

If you're running in development or test environment with a local Beanstalkd
server, you can use the default configuration, which points to `localhost` port
`11300` and uses the prefix `test-` in test envrionment.

If you're running in production against a Beanstalkd, you will likely need to
set the hostname and port number.

If you're running in production against an [Iron.io](https://hud.iron.io/)
server, you will need to set the hostname to `"mq-aws-us-east-1.iron.io"`, and
set the `token` and `projectID` based on the Iron.io project's credentials.


## Contributing

Ironium is written in ECMAScript 6, because better syntax.  Specifically you'll
notice that `let` and `const` replaced all usage of `var`, class definitions are
easier to read in the new syntax, and fat arrows (`=>`) replace `that = this`.
However, the code doesn't use any ES6 library improvements (`Map`, `startsWith`,
etc), since these can't be added without polluting the global namespace.

The source files live in the `src` directory, and compiled into the `lib`
directory with Grunt.  Specifically:

```
grunt build  # Compile source files from src/ into lib/ directory
grunt watch  # Continously compile source files on every change
grunt clean  # Clean compiled files in lib/ directory
grunt        # Shortcut for grunt build watch
```

The test suite is non-existent at the moment, but if it were to exist, you would
run it with `npm test` or `mocha`.

