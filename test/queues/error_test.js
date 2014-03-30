/* global describe, before, it */
const assert      = require('assert');
const ironium     = require('../../src');


describe("processing", ()=> {

  let errorCallback   = ironium.queue('error-callback');
  let errorPromise    = ironium.queue('error-promise');
  let errorGenerator  = ironium.queue('error-generator');

  function untilSuccessful(done) {
    ironium.once((error)=> {
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

    before(()=> errorCallback.push('job'));
    before(untilSuccessful);

    it("should repeat until processed", ()=> {
      assert.equal(runs, 3);
    });

  });


  describe("with rejected promise", ()=> {

    // First two runs should fail, runs ends at 3
    let runs = 0;
    before(()=> {
      errorPromise.each(()=> {
        runs++;
        if (runs > 2)
          return Promise.resolve();
        else
          return Promise.reject(new Error('fail'));
      });
    });

    before(()=> errorPromise.push('job'));
    before(untilSuccessful);

    it("should repeat until processed", ()=> {
      assert.equal(runs, 3);
    });

  });


  describe("with generator error", ()=> {

    // First two runs should fail, runs ends at 3
    let runs = 0;
    before(()=> {
      errorGenerator.each(function*() {
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

    before(()=> errorGenerator.push('job'));
    before(untilSuccessful);

    it("should repeat until processed", ()=> {
      assert.equal(runs, 3);
    });

  });

});

