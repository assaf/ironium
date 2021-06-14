'use strict';

const assert  = require('assert');
const Ironium = require('../..');
const setup   = require('../helpers');


describe('Processing jobs', function() {

  let runMultipleQueue;

  before(setup);

  before(function() {
    runMultipleQueue = Ironium.queue('run-multiple');
  });

  describe('with three handlers', function() {

    // Record jobs run
    const jobs  = [];

    function recordTheStep(step) {
      return function(job) {
        job.step = step; // eslint-disable-line no-param-reassign
        jobs.push(job);
        return Promise.resolve();
      };
    }

    before(function() {
      runMultipleQueue.eachJob(recordTheStep('A'));
      runMultipleQueue.eachJob(recordTheStep('B'));
      runMultipleQueue.eachJob(recordTheStep('C'));
      return runMultipleQueue.queueJob({ foo: '1' });
    });

    before(Ironium.runOnce);

    it('should run all three steps', function() {
      assert.equal(jobs.length, 3);
    });

    it('should provide each handler with a copy of the payload', function() {
      assert.equal(jobs[0].step, 'A');
      assert.equal(jobs[1].step, 'B');
      assert.equal(jobs[2].step, 'C');
    });

  });

  describe('handler expecting job metadata', function() {
    let capturedMetadata;

    before(function() {
      const queueForMetadata = Ironium.queue('for-metadata');
      capturedMetadata = [];

      queueForMetadata.eachJob(function(job, metadata) {
        capturedMetadata.push(metadata);
        return Promise.resolve();
      });

      return queueForMetadata.queueJob({ foo: '1' });
    });

    before(Ironium.runOnce);

    it('should get queue name', function() {
      const actual   = capturedMetadata[0].queueName;
      const expected = 'for-metadata';

      assert.strictEqual(actual, expected);
    });

    it('should get job ID', function() {
      const actual   = capturedMetadata[0].jobID;
      const expected = /^\d+$/;

      assert.match(actual, expected);
    });

    it('should get reserve count', function() {
      const actual   = capturedMetadata[0].receiveCount;
      const expected = 1;

      assert.strictEqual(actual, expected);
    });

    it('should get receipt handle', function() {
      const actual   = 'receiptHandle' in capturedMetadata[0];
      const expected = true;

      assert.strictEqual(actual, expected);
    });
  });

});

