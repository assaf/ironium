'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');


describe('Queue multiple jobs', function() {

  const captureQueue = Ironium.queue('capture');
  const processed    = [];

  // Capture processed jobs here.
  before(() => {
    captureQueue.eachJob((job, callback) => {
      processed.push(job);
      callback();
    });
  });


  describe('objects', () => {
    before(() => processed.splice(0));
    before(() => captureQueue.queueJobs([{ id: 5 }, { id: 6 }]));
    before(Ironium.runOnce);

    it('should process the first object', () => {
      assert.equal(processed[0].id, 5);
    });

    it('should process the second object', () => {
      assert.equal(processed[1].id, 6);
    });
  });


  describe('an array', () => {
    before(() => processed.splice(0));
    before(() => captureQueue.queueJobs([[true, '+'], [false, '-']]));
    before(Ironium.runOnce);

    it('should process the first array', () => {
      assert.equal(processed[0][0], true);
      assert.equal(processed[0][1], '+');
    });

    it('should process the second array', () => {
      assert.equal(processed[1][0], false);
      assert.equal(processed[1][1], '-');
    });
  });


  describe('buffers', () => {

    describe('(JSON)', () => {
      before(() => processed.splice(0));
      before(() => {
        const b1 = new Buffer('{ "x": 1 }');
        const b2 = new Buffer('{ "y": 2 }');
        return captureQueue.queueJobs([ b1, b2 ]);
      });
      before(Ironium.runOnce);

      it('should process the first buffer as object value', () => {
        assert.equal(processed[0].x, 1);
      });

      it('should process the second buffer as object value', () => {
        assert.equal(processed[1].y, 2);
      });
    });


    describe('(not JSON)', () => {
      before(() => processed.splice(0));
      before(() => {
        const b1 = new Buffer('x + 1');
        const b2 = new Buffer('y + 2');
        return captureQueue.queueJobs([ b1, b2 ]);
      });
      before(Ironium.runOnce);

      it('should process the first buffer as string value', () => {
        assert.equal(processed[0], 'x + 1');
      });

      it('should process the second buffer as string value', () => {
        assert.equal(processed[1], 'y + 2');
      });
    });

  });


  describe('a null', () => {
    before(() => processed.splice(0));

    it('should error', done => {
      assert.throws(() => {
        captureQueue.queueJobs([ null ], done);
      });
      assert.equal(processed.length, 0);
      done();
    });
  });

});

