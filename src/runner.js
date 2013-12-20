const assert            = require('assert');
const { createDomain }  = require('domain');


// id      - Job identifier, used for logging and errors
// notify  - Notify when job starts and completes, and of any error
// timeout - Force job to fail if past timeout (optional)
// fn      - The function to execute
function runJob({ id, notify, timeout, fn }) {
  notify.notify("Processing job %s", id);
  // Ideally we call the function, function calls the callback, all is well.
  // But the handler may throw an exception, or suffer some other
  // catastrophic outcome: we use a domain to handle that.  It may also
  // never halt, so we set a timer to force early completion.  And, of
  // course, handler may call callback multiple times, because.
  let domain  = createDomain();
  let errorOnTimeout;
  let promise = new Promise(function(resolve, reject) {

    // Uncaught exception in the handler's domain will also reject the promise.
    domain.on('error', reject);

    if (timeout) {
      // This timer trigger if the job doesn't complete in time and rejects the
      // promise.  Server gets a longer timeout than we do.
      errorOnTimeout = setTimeout(function() {
        reject(new Error("Timeout processing job " + id));
      }, timeout);
      domain.add(errorOnTimeout);
    }
    
    
    // Run the handler within the domain.  We use domain.intercept, so if
    // function throws exception, calls callback with error, or otherwise
    // has uncaught exception, it emits an error event.
    domain.run(function() {

      // Good old callback, let's resolve the job.  Since we intercept it, errors
      // are handled by on('error'), successful callbacks would resolve the job.
      let result = fn(domain.intercept(resolve));

      // Job may have returned a promise or a generator, let's see …
      if (result) {
        if (result.then && result) {
          // A thenable object == promise, let's use it to resolve/reject this
          // job.
          result.then(resolve, reject);
        } else if (result.next && result.throw) {
          resolveWithGenerator(result, resolve, reject);
        }
      }

    });

  });

  // On completion, clear timeout and log.
  promise.then(function() {
    clearTimeout(errorOnTimeout);
    notify.info("Completed job %s", id);
  }, function(error) {
    clearTimeout(errorOnTimeout);
    notify.error("Error processing job %s: %s", id, error.stack);
  });

  return promise;
}


function resolveWithGenerator(generator, resolve, reject) {

  // Call generator.next().  If we just resolved a promise, then we'll pass that
  // value to yield.  Repeat until we're done with the generator.
  function nextFromYield(valueToYield) {
    try {

      let { value, done } = generator.next(valueToYield);
      if (done) {
        resolve();
      } else if (value && typeof(value.then) == 'function') {
        // It's a promise! Resolve it and pass result back to generator
        value.then(nextFromYield, (error)=> generator.throw(error));
      } else {
        generator.throw(new Error("Expected yield promise, received " + value));
      }

    } catch (error) {
      reject(error);
    }
  }

  // Get the party started.
  nextFromYield();

}


function fulfill(...args) {
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


module.exports = {
  runJob,
  fulfill
}

