require('../helpers');
const assert  = require('assert');
const ironium = require('../../src');


describe('queue with delay', ()=> {

  const capture = ironium.queue('capture');
  // Allow up to 2s of delay when running this test suite.
  ironium.config.queues.maxDelay = 2000;

  // Capture processed jobs here.
  const processed = [];

  before(function() {
    capture.each((job, callback)=> {
      processed.push(job);
      callback();
    });
  });

  before(()=> capture.delay('delayed', '2s'));
  before(ironium.once);

  it('should not process immediately', ()=>{
    assert.equal(processed.length, 0);
  });

  describe('after short delay', function() {
    before(function(done) {
      setTimeout(done, 1500);
    });
    before(ironium.once);

    it('should not process job', ()=>{
      assert.equal(processed.length, 0);
    });
  });

  describe('after sufficient delay', function() {
    before(function(done) {
      setTimeout(done, 1000);
    });
    before(ironium.once);

    it('should process job', ()=>{
      assert.equal(processed.length, 1);
      assert.equal(processed[0], 'delayed');
    });
  });

});

