require('../helpers');
const assert  = require('assert');
const ironium = require('../../src');


describe('queue', ()=> {

  const captureQueue = ironium.queue('capture');

  // Capture processed jobs here.
  const processed = [];

  before(function() {
    captureQueue.eachJob((job, callback)=> {
      processed.push(job);
      callback();
    });
  });


  describe('an object', ()=> {
    before(()=> captureQueue.pushJob({ id: 5, name: 'job' }));
    before(ironium.runOnce);

    it('should process that object', ()=>{
      const job = processed[0];
      assert.equal(job.id, 5);
      assert.equal(job.name, 'job');
    });

    after(()=> processed.length = 0);
  });


  describe('a string', ()=> {
    before(()=> captureQueue.pushJob('job'));
    before(ironium.runOnce);

    it('should process that string', ()=>{
      const job = processed[0];
      assert.equal(job, 'job');
    });

    after(()=> processed.length = 0);
  });


  describe('a number', ()=> {
    before(()=> captureQueue.pushJob(3.1));
    before(ironium.runOnce);

    it('should process that number', ()=>{
      const job = processed[0];
      assert.equal(job, 3.1);
    });

    after(()=> processed.length = 0);
  });


  describe('an array', ()=> {
    before(()=> captureQueue.pushJob([true, '+']));
    before(ironium.runOnce);

    it('should process that array', ()=>{
      const job = processed[0];
      assert.equal(job.length, 2);
      assert.equal(job[0], true);
      assert.equal(job[1], '+');
    });

    after(()=> processed.length = 0);
  });


  describe('a null', ()=> {
    it('should error', (done)=> {
      assert.throws(()=> {
        captureQueue.pushJob(null, done);
      });
      assert(processed.length === 0);
      done();
    });
  });

});
