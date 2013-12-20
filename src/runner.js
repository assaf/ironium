const assert            = require('assert');
const co                = require('co');
const { createDomain }  = require('domain');


// id       - Job identifier, used for logging and errors
// notify   - Notify when job starts and completes, and of any error
// timeout  - Force job to fail if past timeout (optional)
// handlers - The functions to execute
// args     - Arguments to pass to each handler
module.exports.runJob = function({ id, notify, timeout, handlers }, ...args) {
  notify.info("Processing job %s", id);
  // Ideally we call the function, function calls the callback, all is well.
  // But the handler may throw an exception, or suffer some other
  // catastrophic outcome: we use a domain to handle that.  It may also
  // never halt, so we set a timer to force early completion.  And, of
  // course, handler may call callback multiple times, because.
  let domain = createDomain();

  let errorOnTimeout;
  if (timeout) {
    // This timer trigger if the job doesn't complete in time and rejects the
    // promise.  Server gets a longer timeout than we do.
    errorOnTimeout = setTimeout(function() {
      domain.emit('error', new Error("Timeout processing job " + id));
    }, timeout);
    domain.add(errorOnTimeout);
  }

  // Each run is a promise, we sequence them.
  let sequence = handlers.reduce(function(promise, handler) {
    return promise.then(()=> promiseFromHandler(handler));
  }, Promise.resolve());

  function promiseFromHandler(handler) {
    let promise = new Promise(function(resolve, reject) {

      // Uncaught exception in the handler's domain will also reject the promise.
      domain.on('error', reject);
      domain.run(function() {

        // Good old callback, let's resolve the job.  Since we intercept it,
        // errors are handled by on('error'), successful callbacks would resolve
        // the job.
        let result = handler(...args, domain.intercept(resolve));

        // Job may have returned a promise or a generator, let's see …
        if (result) {
          if (typeof(result.then) == 'function') {
            // A thenable object == promise, let's use it to resolve/reject this
            // job.
            result.then(resolve, reject);
          } else {
            co(result)(function(error) {
              if (error)
                reject(error);
              else
                resolve();
            });
          }
        }

      });
    });

    return promise;
  }

  // On completion, clear timeout and log.
  sequence.then(function() {
    clearTimeout(errorOnTimeout);
    notify.info("Completed job %s", id);
  }, function(error) {
    clearTimeout(errorOnTimeout);
    notify.error("Error processing job %s: %s", id, error.stack);
  });

  return sequence;
}


module.exports.fulfill = function(...args) {
  let fn;
  if (args.length > 1) {
    let [object, method] = args;
    if (typeof(method) == 'function')
      fn = method.bind(object);
    else
      fn = object[method].bind(object);
  } else
    fn = args[0];

  assert(typeof(fn) == 'function', "Must call callback with a function");
  let promise = new Promise(function(resolve, reject) {

    function callback(error, value) {
      if (error)
        reject(error);
      else
        resolve(value);
    }
    // Make sure to call function *after* we returned the promise.
    setImmediate(function() {
      fn(callback);
    })

  });
  return promise;
}

