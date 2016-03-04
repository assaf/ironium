'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');


describe('Processing jobs', function() {

  const runOnceQueue       = Ironium.queue('run-once');
  const runMultipleQueue   = Ironium.queue('run-multiple');
  const runGeneratorQueue  = Ironium.queue('run-generator');


  describe('with three handlers', function() {

    // Count how many steps run
    const steps = new Set();

    function recordTheStep(step) {
      return function(job, callback) {
        steps.add(step);
        callback();
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


  describe('with generator', function() {

    // Count how many steps run
    const steps = new Set();

    function *recordAllSteps() {
      const one = yield Promise.resolve('A');
      steps.add(one);
      const two = yield thunkB;
      steps.add(two);
      const three = yield* yieldC();
      steps.add(three);
    }

    function thunkB(done) {
      done(null, 'B');
    }

    function *yieldC() {
      yield setImmediate;
      return 'C';
    }

    before(function() {
      runGeneratorQueue.eachJob(recordAllSteps);
      return runGeneratorQueue.queueJob('job');
    });
    before(Ironium.runOnce);

    it('should run all three steps', function() {
      assert.equal(steps.size, 3);
    });

  });

});

