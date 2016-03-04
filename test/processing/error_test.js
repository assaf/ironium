'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');


describe('Running a job', function() {

  const errorCallbackQueue   = Ironium.queue('error-callback');
  const errorPromiseQueue    = Ironium.queue('error-promise');
  const errorGeneratorQueue  = Ironium.queue('error-generator');

  function untilSuccessful() {
    return Ironium.runOnce()
      .catch(function() {
        return untilSuccessful();
      });
  }

  describe('with callback error (twice)', function() {

    // First two runs should fail, runs ends at 3
    let runs = 0;

    function countAndFailJob(job, callback) {
      runs++;
      if (runs > 2)
        callback();
      else
        callback(new Error('fail'));
    }


    before(Ironium.purgeQueues);
    before(function() {
      errorCallbackQueue.eachJob(countAndFailJob);
      return errorCallbackQueue.queueJob('job');
    });
    before(untilSuccessful);

    it('should run three times until successful', function() {
      assert.equal(runs, 3);
    });

  });


  describe('with rejected promise (twice)', function() {

    // First two runs should fail, runs ends at 3
    let runs = 0;

    function countAndFailJob() {
      runs++;
      if (runs > 2)
        return Promise.resolve();
      else
        return Promise.reject(new Error('fail'));
    }

    before(Ironium.purgeQueues);
    before(function() {
      errorCallbackQueue.eachJob(countAndFailJob);
      return errorCallbackQueue.queueJob('job');
    });
    before(untilSuccessful);

    it('should run three times until successful', function() {
      assert.equal(runs, 3);
    });

  });


  describe('with generator error (twice)', function() {

    // First two runs should fail, runs ends at 3
    let runs = 0;

    function* countAndFailJob() {
      runs++;
      switch (runs) {
        case 1: {
          throw new Error('fail');
        }
        case 2: {
          yield Promise.reject(Error('fail'));
          break;
        }
        default: {
          break;
        }
      }
    }

    before(Ironium.purgeQueues);
    before(function() {
      errorCallbackQueue.eachJob(countAndFailJob);
      return errorCallbackQueue.queueJob('job');
    });
    before(untilSuccessful);

    it('should run three times until successful', function() {
      assert.equal(runs, 3);
    });

  });

});

