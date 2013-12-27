const assert            = require('assert');
const co                = require('co');
const { createDomain }  = require('domain');


// Runs the job, return a thunk.
//
// id       - Job identifier, used for logging and errors
// notify   - Notify when job starts and completes, and of any error
// timeout  - Force job to fail if past timeout (optional)
// handlers - The functions to execute
// args     - Arguments to pass to each handler
module.exports = function({ id, notify, timeout, handlers }, ...args) {
  notify.info("Processing job %s", id);
  return co(function*() {
    try {
      for (var handler of handlers)
        yield (resume)=> runJob(handler, args, timeout, resume);
      notify.info("Completed job %s", id);
    } catch (error) {
      notify.info("Error processing job %s: %s", id, error.stack);
      throw error;
    }
  }());
}


// Returns a promise for running this job.
function runJob(handler, args, timeout, callback) {
  var completed = false;
  // Ideally we call the function, function calls the callback, all is well.
  // But the handler may throw an exception, or suffer some other
  // catastrophic outcome: we use a domain to handle that.  It may also
  // never halt, so we set a timer to force early completion.  And, of
  // course, handler may call callback multiple times, because.
  var domain = createDomain();

  var errorOnTimeout;
  if (timeout) {
    // This timer trigger if the job doesn't complete in time and rejects the
    // promise.  Server gets a longer timeout than we do.
    errorOnTimeout = setTimeout(function() {
      domain.emit('error', new Error("Timeout processing job"));
    }, timeout);
    domain.add(errorOnTimeout);
  }

  // Uncaught exception in the handler's domain will also fail this job.
  domain.on('error', function(error) {
    if (!completed) {
      completed = true;
      callback(error);
    }
  });
  domain.run(function() {

    // Good old callback, var's resolve the job.  Since we intercept it,
    // errors are handled by on('error'), successful callbacks would resolve
    // the job.
    var result = handler(...args, domain.intercept(successful));

    // Job may have returned a promise or a generator, var's see …
    if (result) {
      if (typeof(result.then) == 'function') {
        // A thenable object == promise.  Use it to resolve job instead of
        // callback.
        result.then(successful,
          function(error) {
            domain.emit('error', error);
          });
      } else if (typeof(result.next) == 'function') {
        // A generator.  Use it to resolve job instead of callback.
        co(result)(function(error) {
          if (error)
             domain.emit('error', error);
           else
             successful();
        });
      }
    }

  });

  function successful() {
    if (!completed) {
      completed = true;
      callback();
    }
  }
}
