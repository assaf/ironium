const { createDomain }  = require('domain');


// id      - Job identifier, used for logging and errors
// notify  - Notify when job starts and completes, and of any error
// timeout - Force job to fail if past timeout (optional)
// fn      - The function to execute
module.exports = function runJob({ id, notify, timeout, fn }) {
  notify.debug("Processing job %s", id);
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
      if (done)
        resolve();
      else
        nextValue(value);
    } catch (error) {
      reject(error);
    }
  }

  // Get the party started.
  nextFromYield();


  // Handle the result of a yield, which can be one of:
  // - We're done with this generator, resolve this job.
  // - It's a promise! resolve it and pass the result back to the
  //   generator.
  // - Empty yield is our cue to provide a callback.
  // - Ignore any other value
  function nextValue(value) {
    if (value && value.then && value) {
      // It's a promise! Resolve it and pass result back to generator
      value.then((resolvedValue)=> nextFromYield(resolvedValue),
                 (error)=> generator.throw(error));
    } else if (value === undefined) {
      // The generator does something like:
      //    var callback = yield;
      //    setTimeout(callback, 1000);
      //
      // This is the callback function that we pass through yield,
      // and we do so by calling next, which executes the code that
      // includes setTimeout.  We're going to wait on the callback to
      // complete before doing anything with the value provided by
      // the generator.
      try {
        function callback(error) {
          if (error)
            generator.throw(error);
          else
            nextValue(value, done);
        }
        let { value, done } = generator.next(callback);
      } catch (error) {
        reject(error);
      }
    } else {
      // yield noop essentially, useful for waiting for callbacks.
      nextFromYield();
    }
  }

}

