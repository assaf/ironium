'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');


describe('Queue multiple jobs', function() {

  const captureQueue = Ironium.queue('capture');
  const processed    = [];

  // Capture processed jobs here.
  before(function() {
    captureQueue.eachJob(function(job) {
      processed.push(job);
      return Promise.resolve();
    });
  });


  describe('objects', function() {
    before(function() {
      processed.splice(0);
    });
    before(function() {
      return captureQueue.queueJobs([{ id: 5 }, { id: 6 }]);
    });
    before(Ironium.runOnce);

    it('should process the first object', function() {
      assert.equal(processed[0].id, 5);
    });

    it('should process the second object', function() {
      assert.equal(processed[1].id, 6);
    });
  });


  describe('an array', function() {
    before(function() {
      processed.splice(0);
    });
    before(function() {
      return captureQueue.queueJobs([[true, '+'], [false, '-']]);
    });
    before(Ironium.runOnce);

    it('should process the first array', function() {
      assert.equal(processed[0][0], true);
      assert.equal(processed[0][1], '+');
    });

    it('should process the second array', function() {
      assert.equal(processed[1][0], false);
      assert.equal(processed[1][1], '-');
    });
  });


  describe('buffers', function() {

    describe('(JSON)', function() {
      before(function() {
        processed.splice(0);
      });
      before(function() {
        const b1 = new Buffer('{ "x": 1 }');
        const b2 = new Buffer('{ "y": 2 }');
        return captureQueue.queueJobs([ b1, b2 ]);
      });
      before(Ironium.runOnce);

      it('should process the first buffer as object value', function() {
        assert.equal(processed[0].x, 1);
      });

      it('should process the second buffer as object value', function() {
        assert.equal(processed[1].y, 2);
      });
    });


    describe('(not JSON)', function() {
      before(function() {
        processed.splice(0);
      });
      before(function() {
        const b1 = new Buffer('x + 1');
        const b2 = new Buffer('y + 2');
        return captureQueue.queueJobs([ b1, b2 ]);
      });
      before(Ironium.runOnce);

      it('should process the first buffer as string value', function() {
        assert.equal(processed[0], 'x + 1');
      });

      it('should process the second buffer as string value', function() {
        assert.equal(processed[1], 'y + 2');
      });
    });

  });


  describe('a null', function() {
    before(function() {
      processed.splice(0);
    });

    it('should error', function(done) {
      assert.throws(function() {
        captureQueue.queueJobs([ null ]).catch(done);
      });
      assert.equal(processed.length, 0);
      done();
    });
  });

});

