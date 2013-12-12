# Job Queues

A simple API for working with job queues.  Can use
[Iron.io](http://www.iron.io/) or Beanstalkd.


## Accessing Queues

The API consists of a single function that returns the named queue:

```
var queues  = require("./lib/queues");
var myQueue = queues("my-queue");
```

Pushing and processing messages is done via the returned queue object (see
below).

An additional method is available in test environment only, to discard of all
queues before/after running test:

```
before(queues.clearAll);
```


## Using Queues

### put(job, options, callback)

Use the `put` method to put a job in the queue.

- job       - The object to place on the queue.  This object is serialized into
  a JSON string, so must only contain data values, no circular references.
- options   - Control how the job is processed (see below)
- callback  - Optional

Currently supported options:

- delay     - How long before the job is available, in seconds, defaults to 0

If you're queuing requests initiated by the end-user, you likely care whether
the job was queued successfully.  Use a callback to determine that.


### get(handler, concurrency)

Use the `get` method to process jobs from the queue.

- handler     - The function that will be called for each job

The handler is called for each job with the following arguments:

- job     - The job to process
- done    - Called when done processing the job

The job to process is typically an object de-serialized from the JSON
representation (see `put` method).  However, it may also be a string, e.g.
FullContact pushes URL-encoded name/value pairs to the queue.

Once the job has been processed successfully, the handler must call then `done`
method.

If the job cannot be processed successfully, the handler calls `done` with an
error: the error will be logged, and the job will be put back in the queue, from
where it will be processed again after a short delay.

If the handler does not complete in time (60 seconds), the job will be returned
to the queue and the next job will be processed.

Handlers are invoked sequentially, except for the case where a handler is
considered to have timed-out.


### name

This property returns the queue name.


### webhookURL

This property returns the URL of a Webhook end-point associated with this queue.
Messages posted to this URL will show up as jobs in the queue.


### onDrain(callback)

Called when there are no more messages to process.  This is only availabe in
test environment.


### clear(callback)

Remove all jobs from the queue.  This is only availabe in test environment.


## Iron.io

To use [Iron.io](http://hud.iron.io/), the queue configuration must specify the
following properties:

* `host`      - The Iron.io host name
* `projectID` - The project identifier
* `token`     - The authentication token

These can be specified in the configuration file, or by setting the environment
variables `IRON_PROJECT_ID` and `IRONIO_TOKEN`.

Please use the testing project ID when testing the Iron.io integration.


## Testing/Development

For regular testing and development, we use Beanstalkd.  The queue configuration
need only specify:

* `host` - The hostname (defaults to "localhost")
* `port` - The port number (defaults to 11300)

When testing, the `queues` function has two properties you can call on it that
affect all queues.

### onDrainAll(callback)

Called when there are no more messages to process on any queue.

### clearAll(callback)

Remove all jobs from all queues.


