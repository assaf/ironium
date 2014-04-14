var assert            = require('assert');
var co                = require('co');
var { createDomain }  = require('domain');


// Runs the job, returns a promise.
//
// handler  - Called to process the job
// args     - With the given arguments
// timeout  - If set, times out job after that many ms
module.exports = function runJob(handler, args, timeout) {
  assert(handler, "Handler is missing");

  return new Promise(function(resolve, reject) {

    // Ideally we call the function, function calls the callback, all is well.
    // But the handler may throw an exception, or suffer some other
    // catastrophic outcome: we use a domain to handle that.  It may also
    // never halt, so we set a timer to force early completion.
    var domain = createDomain();

    if (timeout) {
      // This timer trigger if the job doesn't complete in time and rejects the
      // promise.  Server gets a longer timeout than we do.
      var errorOnTimeout = setTimeout(function() {
        domain.emit('error', new Error("Timeout processing job"));
      }, timeout);
      domain.add(errorOnTimeout);
    }

    // Uncaught exception in the handler's domain will also fail this job.
    domain.on('error', reject);
    domain.run(function() {

      // Good old callback, var's resolve the job.  Since we intercept it,
      // errors are handled by on('error'), successful completion resolves.
      var result = handler(...args, domain.intercept(resolve));

      // Job may have returned a promise or a generator, var's see …
      if (result && typeof(result.then) == 'function') {
        // A thenable object == promise.
        result.then(resolve, function(error) {
          if (!(error instanceof Error))
            error = new Error(error.toString() + ' in ' + handler.toString());
          domain.emit('error', error);
        });
      } else if (result && typeof(result.next) == 'function' &&
                 typeof(result.throw) == 'function') {
        // A generator object.  Use it to resolve job instead of callback.
        co(result)(function(error) {
          if (error)
            domain.emit('error', error);
          else
            resolve();
        });
      }

    });

  });

};
