'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');


describe('Running a job', function() {

  const errorPromiseQueue    = Ironium.queue('error-promise');

  function untilSuccessful() {
    return Ironium.runOnce()
      .catch(function() {
        return untilSuccessful();
      });
  }


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
      errorPromiseQueue.eachJob(countAndFailJob);
      return errorPromiseQueue.queueJob('job');
    });
    before(untilSuccessful);

    it('should run three times until successful', function() {
      assert.equal(runs, 3);
    });

  });

});

