'use strict';
const assert    = require('assert');
const Bluebird  = require('bluebird');
const Domain    = require('domain');
const Promise   = require('bluebird');


// Runs the job, returns a promise.
//
// jobID    - Available from domain
// handler  - Called to process the job
// args     - With the given arguments
// timeout  - If set, times out job after that many ms
module.exports = function runJob(jobID, handler, args, timeout) {
  assert(handler, 'Handler is missing');

  // Ideally we call the function, function calls the callback, all is well.
  // But the handler may throw an exception, or suffer some other
  // catastrophic outcome: we use a domain to handle that.  It may also
  // never halt, so we set a timer to force early completion.
  const domain = Domain.createDomain();

  const promise = new Promise(function(resolve, reject) {

    domain.jobID = jobID;

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
      }, timeout);
      errorOnTimeout.unref();
      domain.add(errorOnTimeout);
    }

    domain.run(function() {
      // Handler is a generator function (ES6, Babel.js)
      if (handler.constructor.name === 'GeneratorFunction')
        runGenerator(handler, args, domain, resolve, reject);
      else {
        // Good old callback resolves the job.  Since we intercept it,
        // errors are handled by on('error'), successful completion resolves.
        const result = handler.apply(null, args.concat( asCallback(domain, resolve, reject) ));

        // Job may have returned a promise or a generator
        if (result && typeof(result.then) === 'function')
          runThenable(result, domain, resolve, reject);
        // Otherwise it's a callback, wait for it to resolve job
      }
    });

  });
  return promise;

};


// Handler is a generator function (ES6, Babel.js)
function runGenerator(generator, args, domain, resolve, reject) {
  Bluebird.coroutine(generator, { yieldHandler })(...args)
    .then(function() {
      domain.exit();
      resolve();
    })
    .catch(function(error) {
      domain.exit();
      reject(error);
    });
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
function runThenable(thenable, domain, resolve, reject) {
  // A thenable: cast it to a promise we can handle
  Promise.resolve(thenable)
    .then(function() {
      domain.exit();
      resolve();
    })
    .catch(function(error) {
      domain.exit();
      reject(error);
    });
}


// Handler can use this callback if it wants to
function asCallback(domain, resolve, reject) {
  return function callback(error) {
    domain.exit();
    if (error)
      reject(error);
    else
      resolve();
  };
}

