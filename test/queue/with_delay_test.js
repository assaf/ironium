'use strict';

const assert  = require('assert');
const Ironium = require('../..');
const setup   = require('../helpers');


describe('Queue with delay', function() {

  let captureQueue;

  // Capture processed jobs here.
  const processed = [];

  before(setup);
  before(function() {
    Ironium.configure({ concurrency: 1 });
    captureQueue = Ironium.queue(`capture-${Date.now()}`);
  });

  before(function() {
    captureQueue.eachJob(function(job) {
      processed.push(job);
      return Promise.resolve();
    });
  });

  before(function() {
    return captureQueue.delayJob('delayed', '2s');
  });
  before(Ironium.runOnce);

  it('should not process immediately', function() {
    assert.equal(processed.length, 0);
  });

  describe('after short delay', function() {
    before(function(done) {
      setTimeout(done, 1500);
    });
    before(Ironium.runOnce);

    it('should not process job', function() {
      assert.equal(processed.length, 0);
    });
  });

  describe('after sufficient delay', function() {
    before(function(done) {
      setTimeout(done, 1000);
    });
    before(Ironium.runOnce);

    it('should process job', function() {
      assert.equal(processed.length, 1);
      assert.equal(processed[0], 'delayed');
    });
  });

});

