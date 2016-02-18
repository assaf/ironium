'use strict';
const assert    = require('assert');
const Bluebird  = require('bluebird');
const Domain    = require('domain');


// Runs the job, returns a promise.
//
// jobID    - Available from domain
// handler  - Called to process the job
// args     - With the given arguments
// timeout  - If set, times out job after that many seconds
module.exports = function runJob(jobID, handler, args, timeout) {
  assert(typeof(handler) === 'function', 'Handler is missing or not a function');

  // Ideally we call the function, function calls the callback, all is well.
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
      // Timeouts occur if handler never calls its callback, resolves promise,
      // etc.
      const errorOnTimeout = setTimeout(function() {
        reject(new Error('Timeout processing job'));
      }, timeout * 1000);
      errorOnTimeout.unref();
      domain.add(errorOnTimeout);
    }

    domain.run(function() {
      if (handler.constructor.name === 'GeneratorFunction') {

        // Handler is a generator function (ES6, Babel.js)
        const generator = handler;
        runGenerator(generator, args, resolve, reject);

      } else {

        // Good old callback resolves the job.  Since we intercept it, errors
        // are handled by on('error'), successful completion resolves.
        const callback          = asCallback(resolve, reject);
        const argsWithCallback  = args.concat(callback);
        const result            = handler.apply(null, argsWithCallback);

        // Job may have returned a promise or a generator
        if (result && typeof(result.then) === 'function') {
          const thenable = result;
          runThenable(thenable, resolve, reject);
        }

        // Otherwise it's a callback, wait for it to resolve job
      }
    });

  });
  return promise;

};


// Handler is a generator function (ES6, Babel.js)
function runGenerator(generator, args, resolve, reject) {
  const coroutine = Bluebird.coroutine(generator, { yieldHandler });
  const asPromise = coroutine.apply(null, args);
  asPromise.then(resolve, reject);
}


// Support for generators and thunks, see
// https://github.com/petkaantonov/bluebird/blob/master/API.md#promisecoroutineaddyieldhandlerfunction-handler---void
function yieldHandler(value) {
  if (typeof(value) === 'function') {
    const asPromise = new Promise(function(resolve, reject) {
      try {
        value(function(error, value) {
          if (error)
            reject(error);
          else
            resolve(value);
        });
      } catch(error) {
        reject(error);
      }
    });
    return asPromise;
  }
}

// Handler returns a promise.
function runThenable(thenable, resolve, reject) {
  // A thenable: cast it to a promise we can handle
  const asPromise = Promise.resolve(thenable);
  asPromise.then(resolve, reject);
}


// Handler can use this callback if it wants to
function asCallback(resolve, reject) {
  return function callback(error) {
    if (error)
      reject(error);
    else
      resolve();
  };
}

