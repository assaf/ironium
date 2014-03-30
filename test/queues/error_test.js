var assert      = require('assert');
var Helpers     = require('../helpers');
var { Promise } = require('es6-promise');
var ironium     = require('../../src');


describe("processing", ()=> {

  var errorCallback   = ironium.queue('error-callback');
  var errorPromise    = ironium.queue('error-promise');
  var errorGenerator  = ironium.queue('error-generator');

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
      errorPromise.each((job)=> {
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

    before(()=> errorGenerator.push('job'));
    before(untilSuccessful);

    it("should repeat until processed", ()=> {
      assert.equal(runs, 3);
    });

  });

});

