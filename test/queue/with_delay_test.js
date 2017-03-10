'use strict';
require('../helpers');
const assert      = require('assert');
const Ironium     = require('../..');
const ms          = require('ms');
const TimeKeeper  = require('timekeeper');


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

  before(function() {
    return captureQueue.delayJob('delayed', '2m');
  });

  before(Ironium.runOnce);

  it('should not process immediately', function() {
    assert.equal(processed.length, 0);
  });

  describe('after 1 minute', function() {
    before(function() {
      TimeKeeper.travel(Date.now() + ms('1m'));
    });

    before(Ironium.runOnce);

    it('should not process job', function() {
      assert.equal(processed.length, 0);
    });
  });

  describe('after 2 minutes', function() {
    before(function() {
      TimeKeeper.travel(Date.now() + ms('2m'));
    });

    before(Ironium.runOnce);

    it('should process job', function() {
      assert.equal(processed.length, 1);
      assert.equal(processed[0], 'delayed');
    });
  });

});

