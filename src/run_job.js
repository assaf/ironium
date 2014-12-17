const assert            = require('assert');
const co                = require('co');
const { createDomain }  = require('domain');
const Promise           = require('bluebird');


// Runs the job, returns a promise.
//
// jobID    - Available from domain
// handler  - Called to process the job
// args     - With the given arguments
// timeout  - If set, times out job after that many ms
module.exports = function runJob(jobID, handler, args, timeout) {
  assert(handler, 'Handler is missing');

  return new Promise(function(resolve, reject) {

    // Ideally we call the function, function calls the callback, all is well.
    // But the handler may throw an exception, or suffer some other
    // catastrophic outcome: we use a domain to handle that.  It may also
    // never halt, so we set a timer to force early completion.
    const domain = createDomain();

    if (timeout) {
      // This timer trigger if the job doesn't complete in time and rejects the
      // promise.  Server gets a longer timeout than we do.
      //
      // Timeouts occur if handler never calls its callback, resolves promise,
      // etc.
      const errorOnTimeout = setTimeout(function() {
        domain.emit('error', new Error('Timeout processing job'));
      }, timeout);
      errorOnTimeout.unref();
      domain.add(errorOnTimeout);
    }

    domain.jobID = jobID;

    // Uncaught exception in the handler's domain will also fail this job.
    domain.on('error', reject);
    domain.run(function() {

      // Good old callback resolves the job.  Since we intercept it,
      // errors are handled by on('error'), successful completion resolves.
      const result = handler(...args, domain.intercept(resolve));

      // Job may have returned a promise or a generator
      if (result && typeof(result.next) === 'function' && typeof(result.throw) === 'function') {
        // A generator object.  Use it to resolve job instead of callback.
        co(result).then(resolve, function(error) {
          domain.emit('error', error);
        });
      } else if (result && typeof(result.then) === 'function') {
        // A thenable: cast it to a promise we can handle
        Promise.resolve(result)
          .then(resolve, function(error) {
            if (!(error instanceof Error))
              error = new Error(`${error} in ${handler}`);
            domain.emit('error', error);
          });
      }
      // Otherwise it's a callback, wait for it to resolve job

    });

  });

};
