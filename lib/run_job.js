'use strict';
const assert    = require('assert');
const Domain    = require('domain');


// Work around domains leaking when using Bluebird.
Domain.createDomain().enter();


// Runs the job, returns a promise.
//
// jobID    - Available from domain
// handler  - Called to process the job
// args     - With the given arguments
// timeout  - If set, times out job after that many milliseconds
module.exports = function runJob(jobID, handler, args, timeout) {
  assert(typeof handler === 'function', 'Handler is missing or not a function');

  // Ideally we call the function, function resolves its promise, all is well.
  // But the handler may throw an exception, or suffer some other
  // catastrophic outcome: we use a domain to handle that.  It may also
  // never halt, so we set a timer to force early completion.
  const domain = Domain.createDomain();
  domain.jobID = jobID;

  const promise = new Promise(function(resolve, reject) {
    // Uncaught exception in the handler's domain will also fail this job.
    domain.on('error', reject);

    if (timeout) {
      // This timer trigger if the job doesn't complete in time and rejects the
      // promise.  Server gets a longer timeout than we do.
      //
      // Timeouts occur if handler never resolves its promise.
      const errorOnTimeout = setTimeout(function() {
        reject(new Error('Timeout processing job'));
      }, timeout);
      errorOnTimeout.unref();
      domain.add(errorOnTimeout);
    }

    domain.run(function() {
      console.log(args);
      const result = handler.apply(null, args);

      // Job handler must return a Promise.
      if (result && typeof result.then === 'function') {
        Promise.resolve(result)
          .then(resolve, reject);
      } else
        reject(new Error('Job handler must return a Promise.'));
    });
  });

  return promise;
};
