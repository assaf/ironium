'use strict';
const assert    = require('assert');
const Ironium   = require('../..');
const { reset } = require('../helpers');


describe('Processing jobs', function() {

  const runMultipleQueue = Ironium.queue('run-multiple');

  before(reset);

  describe('with three handlers', function() {

    // Count how many steps run
    const steps = new Set();

    function recordTheStep(step) {
      return function() {
        steps.add(step);
        return Promise.resolve();
      };
    }

    before(function() {
      runMultipleQueue.eachJob(recordTheStep('A'));
      runMultipleQueue.eachJob(recordTheStep('B'));
      runMultipleQueue.eachJob(recordTheStep('C'));
      return runMultipleQueue.queueJob('job');
    });
    before(Ironium.runOnce);

    it('should run all three steps', function() {
      assert.equal(steps.size, 3);
    });

  });

});

