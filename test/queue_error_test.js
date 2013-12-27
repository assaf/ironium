const assert      = require('assert');
const Helpers     = require('./helpers');
const { Promise } = require('es6-promise');
const workers     = require('../src');


describe("processing", ()=> {

  const errorCallback   = workers.queue('error-callback');
  const errorPromise    = workers.queue('error-promise');
  const errorGenerator  = workers.queue('error-generator');

  function untilSuccessful(done) {
    workers.once((error)=> {
      if (error)
        setTimeout(()=> untilSuccessful(done));
      else
        done();
    });
  }

  describe("with callback error", ()=> {

    // First two runs should fail, runs ends at 3
    let runs = 0;
    before(()=> {
      errorCallback.each((job, callback)=> {
        runs++;
        if (runs > 2)
          callback();
        else
          callback(new Error('fail'));
      });
    });

    before(errorCallback.push('job'));
    before(untilSuccessful);

    it("should repeat until processed", ()=> {
      assert.equal(runs, 3);
    });

  });


  describe("with rejected promise", ()=> {

    // First two runs should fail, runs ends at 3
    let runs = 0;
    before(()=> {
      errorPromise.each((job)=> {
        runs++;
        if (runs > 2)
          return Promise.resolve();
        else
          return Promise.reject(new Error('fail'));
      });
    });

    before(errorPromise.push('job'));
    before(untilSuccessful);

    it("should repeat until processed", ()=> {
      assert.equal(runs, 3);
    });

  });


  describe("with generator error", ()=> {

    // First two runs should fail, runs ends at 3
    let runs = 0;
    before(()=> {
      errorGenerator.each(function*(job) {
        runs++;
        switch (runs) {
          case 1: {
            throw new Error('fail');
          }
          case 2: {
            yield Promise.reject(Error('fail'));
            break;
          }
        }
      });
    });

    before(errorGenerator.push('job'));
    before(untilSuccessful);

    it("should repeat until processed", ()=> {
      assert.equal(runs, 3);
    });

  });

});

