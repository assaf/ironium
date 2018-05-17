'use strict';

const assert       = require('assert');
const Bluebird     = require('bluebird');
const Crypto       = require('crypto');
const getAWSConfig = require('../aws_config');
const Ironium      = require('../..');
const ms           = require('ms');
const setup        = require('../helpers');


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


(getAWSConfig.isAvailable ? describe : describe.skip)('Queue with delay - SQS', function() {
  const randomJobID = Crypto.randomBytes(256).toString('hex');
  let runs = 0;
  let queue;

  before(setup);

  before(function() {
    Ironium._queues._queues.clear();
    Ironium._scheduler._schedules.clear();
  });

  before(function() {
    const config = Object.assign({}, getAWSConfig(), { concurrency: 1 });
    Ironium.configure(config);
    queue = Ironium.queue('foo');
    return queue.purgeQueue();
  });

  before(function() {
    queue.eachJob(function(job) {
      if (job === randomJobID) {
        runs++;
        return Promise.resolve();
      } else
        return Promise.reject(new Error('Return to queue'));
    });
  });

  before(function() {
    return queue.delayJob(randomJobID, '2s');
  });

  before(function() {
    Ironium.start();
  });

  it('should not process immediately', function() {
    assert.equal(runs, 0);
  });

  describe('after short delay', function() {
    before(function() {
      return Bluebird.delay(ms('1.5s'));
    });

    it('should not process job', function() {
      assert.equal(runs, 0);
    });
  });

  describe('after sufficient delay', function() {
    before(function() {
      return Bluebird.delay(ms('2s'));
    });

    it('should process job', function() {
      assert.equal(runs, 1);
    });
  });

  after(function() {
    Ironium.stop();
    Ironium.configure({});
  });
});

