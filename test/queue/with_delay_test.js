'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');


describe('Queue with delay', ()=> {

  const captureQueue = Ironium.queue('capture');

  // Capture processed jobs here.
  const processed = [];

  before(function() {
    captureQueue.eachJob(function(job, callback) {
      processed.push(job);
      callback();
    });
  });

  before(()=> captureQueue.delayJob('delayed', '2s'));
  before(Ironium.runOnce);

  it('should not process immediately', ()=>{
    assert.equal(processed.length, 0);
  });

  describe('after short delay', function() {
    before(function(done) {
      setTimeout(done, 1500);
    });
    before(Ironium.runOnce);

    it('should not process job', ()=>{
      assert.equal(processed.length, 0);
    });
  });

  describe('after sufficient delay', function() {
    before(function(done) {
      setTimeout(done, 1000);
    });
    before(Ironium.runOnce);

    it('should process job', ()=>{
      assert.equal(processed.length, 1);
      assert.equal(processed[0], 'delayed');
    });
  });

});

