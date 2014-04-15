require('../helpers');
var assert  = require('assert');
var ironium = require('../../src');


describe("queue with delay", ()=> {

  var capture = ironium.queue('capture');

  // Capture processed jobs here.
  var processed = [];

  before(function() {
    capture.each((job, callback)=> {
      processed.push(job);
      callback();
    });
  });

  before(()=> capture.delay('delayed', '2s'));
  before(()=> ironium.once());

  it("should not process immediately", ()=>{
    assert.equal(processed.length, 0);
  });

  describe("after short delay", function() {
    before(function(done) {
      setTimeout(done, 1500);
    });
    before(()=> ironium.once());

    it("should not process job", ()=>{
      assert.equal(processed.length, 0);
    });
  });

  describe("after sufficient delay", function() {
    before(function(done) {
      setTimeout(done, 1000);
    });
    before(()=> ironium.once());

    it("should process job", ()=>{
      assert.equal(processed.length, 1);
      assert.equal(processed[0], 'delayed');
    });
  });

});

