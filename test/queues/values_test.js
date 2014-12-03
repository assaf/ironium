require('../helpers');
const assert  = require('assert');
const ironium = require('../../src');


describe("queue", ()=> {

  const capture = ironium.queue('capture');

  // Capture processed jobs here.
  const processed = [];

  before(function() {
    capture.each((job, callback)=> {
      processed.push(job);
      callback();
    });
  });


  describe("an object", ()=> {
    before(()=> capture.push({ id: 5, name: 'job' }));
    before(ironium.once);

    it("should process that object", ()=>{
      const job = processed[0];
      assert.equal(job.id, 5);
      assert.equal(job.name, 'job');
    });

    after(()=> processed.length = 0);
  });


  describe("a string", ()=> {
    before(()=> capture.push('job'));
    before(ironium.once);

    it("should process that string", ()=>{
      const job = processed[0];
      assert.equal(job, 'job');
    });

    after(()=> processed.length = 0);
  });


  describe("a number", ()=> {
    before(()=> capture.push(3.1));
    before(ironium.once);

    it("should process that number", ()=>{
      const job = processed[0];
      assert.equal(job, 3.1);
    });

    after(()=> processed.length = 0);
  });


  describe("an array", ()=> {
    before(()=> capture.push([true, '+']));
    before(ironium.once);

    it("should process that array", ()=>{
      const job = processed[0];
      assert.equal(job.length, 2);
      assert.equal(job[0], true);
      assert.equal(job[1], '+');
    });

    after(()=> processed.length = 0);
  });


  describe("a null", ()=> {
    it("should error", (done)=> {
      assert.throws(()=> {
        capture.push(null, done);
      });
      assert(processed.length === 0);
      done();
    });
  });

});
