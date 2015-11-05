'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');


describe('Queue', function() {

  const captureQueue = Ironium.queue('capture');

  // Capture processed jobs here.
  before(()=> {
    captureQueue.eachJob((job, callback)=> {
      this.job = job;
			callback();
    });
  });


  describe('an object', ()=> {
    before(()=> captureQueue.queueJob({ id: 5, name: 'job' }));
    before(Ironium.runOnce);

    it('should process that object', ()=>{
      assert.equal(this.job.id, 5);
      assert.equal(this.job.name, 'job');
    });
  });


  describe('a string', ()=> {
    before(()=> captureQueue.queueJob('job'));
    before(Ironium.runOnce);

    it('should process that string', ()=>{
      assert.equal(this.job, 'job');
    });
  });


  describe('a number', ()=> {
    before(()=> captureQueue.queueJob(3.1));
    before(Ironium.runOnce);

    it('should process that number', ()=>{
      assert.equal(this.job, 3.1);
    });
  });


  describe('an array', ()=> {
    before(()=> captureQueue.queueJob([true, '+']));
    before(Ironium.runOnce);

    it('should process that array', ()=>{
      assert.equal(this.job.length, 2);
      assert.equal(this.job[0], true);
      assert.equal(this.job[1], '+');
    });
  });


  describe('a buffer', ()=> {

    describe('(JSON)', ()=> {
      before(()=> captureQueue.queueJob(new Buffer('{ "x": 1 }')));
      before(Ironium.runOnce);

      it('should process that buffer as object value', ()=>{
        assert.equal(this.job.x, 1);
      });
    });


    describe('(not JSON)', ()=> {
      before(()=> captureQueue.queueJob(new Buffer('x + 1')));
      before(Ironium.runOnce);

      it('should process that buffer as string value', ()=>{
        assert.equal(this.job, 'x + 1');
      });
    });

  });


  describe('a null', ()=> {
    it('should error', (done)=> {
      this.job = null;
      assert.throws(()=> {
        captureQueue.queueJob(null, done);
      });
      assert(!this.job);
      done();
    });
  });

});

