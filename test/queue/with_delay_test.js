'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');


describe('Queue with delay', function() {

  const captureQueue = Ironium.queue('capture');

  // Capture processed jobs here.
  const processed = [];

  before(function() {
    captureQueue.eachJob(function(job) {
      processed.push(job);
      return Promise.resolve();
    });
  });

  before(()=> captureQueue.delayJob('delayed', '2s'));
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

