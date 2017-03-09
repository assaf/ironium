'use strict';

const assert    = require('assert');
const Ironium   = require('../..');
const { reset } = require('../helpers');


describe('Queue', function() {
  let lastJob;
  const captureQueue = Ironium.queue('capture');

  before(reset);

  // Capture processed jobs here.
  before(function() {
    captureQueue.eachJob(function(job) {
      lastJob = job;
      return Promise.resolve();
    });
  });


  describe('an object', function() {
    before(function() {
      return captureQueue.queueJob({ id: 5, name: 'job' });
    });
    before(Ironium.runOnce);

    it('should process that object', function() {
      assert.equal(lastJob.id, 5);
      assert.equal(lastJob.name, 'job');
    });
  });


  describe('a string', function() {
    before(function() {
      return captureQueue.queueJob('job');
    });
    before(Ironium.runOnce);

    it('should process that string', function() {
      assert.equal(lastJob, 'job');
    });
  });


  describe('a number', function() {
    before(function() {
      return captureQueue.queueJob(3.1);
    });
    before(Ironium.runOnce);

    it('should process that number', function() {
      assert.equal(lastJob, 3.1);
    });
  });


  describe('an array', function() {
    before(function() {
      return captureQueue.queueJob([true, '+']);
    });
    before(Ironium.runOnce);

    it('should process that array', function() {
      assert.equal(lastJob.length, 2);
      assert.equal(lastJob[0], true);
      assert.equal(lastJob[1], '+');
    });
  });


  describe('a buffer', function() {

    describe('(JSON)', function() {
      before(function() {
        return captureQueue.queueJob(new Buffer('{ "x": 1 }'));
      });
      before(Ironium.runOnce);

      it('should process that buffer as object value', function() {
        assert.equal(lastJob.x, 1);
      });
    });


    describe('(not JSON)', function() {
      before(function() {
        return captureQueue.queueJob(new Buffer('x + 1'));
      });
      before(Ironium.runOnce);

      it('should process that buffer as string value', function() {
        assert.equal(lastJob, 'x + 1');
      });
    });

  });


  describe('a null', function() {
    before(function() {
      lastJob = null;
    });

    it('should error', function(done) {
      assert.throws(function() {
        captureQueue.queueJob(null).catch(done);
      });
      assert(!lastJob);
      done();
    });
  });

});

