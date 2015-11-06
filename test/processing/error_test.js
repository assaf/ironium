'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');


describe('Processing', ()=> {

  const errorCallbackQueue   = Ironium.queue('error-callback');
  const errorPromiseQueue    = Ironium.queue('error-promise');
  const errorGeneratorQueue  = Ironium.queue('error-generator');

  function untilSuccessful() {
    return Ironium.runOnce()
      .catch(function() {
        return untilSuccessful();
      });
  }

  describe('with callback error', ()=> {

    // First two runs should fail, runs ends at 3
    let runs = 0;
    before(()=> {
      errorCallbackQueue.eachJob((job, callback)=> {
        runs++;
        if (runs > 2)
          callback();
        else
          callback(new Error('fail'));
      });
    });

    before(()=> errorCallbackQueue.queueJob('job'));
    before(untilSuccessful);

    it('should repeat until processed', ()=> {
      assert.equal(runs, 3);
    });

  });


  describe('with rejected promise', ()=> {

    // First two runs should fail, runs ends at 3
    let runs = 0;
    before(()=> {
      errorPromiseQueue.eachJob(()=> {
        runs++;
        if (runs > 2)
          return Promise.resolve();
        else
          return Promise.reject(new Error('fail'));
      });
    });

    before(()=> errorPromiseQueue.queueJob('job'));
    before(untilSuccessful);

    it('should repeat until processed', ()=> {
      assert.equal(runs, 3);
    });

  });


  describe('with generator error', ()=> {

    // First two runs should fail, runs ends at 3
    let runs = 0;
    before(()=> {
      errorGeneratorQueue.eachJob(function*() {
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

    before(()=> errorGeneratorQueue.queueJob('job'));
    before(untilSuccessful);

    it('should repeat until processed', ()=> {
      assert.equal(runs, 3);
    });

  });

});

