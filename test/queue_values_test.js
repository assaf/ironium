const assert  = require('assert');
const Helpers = require('./helpers');
const workers = require('../src');


describe("queue", ()=> {

  const capture = workers.queue('capture');

  // Capture processed jobs here.
  let processed = [];

  before(function() {
    capture.each((job, callback)=> {
      processed.push(job);
      callback();
    });
  });


  describe("an object", ()=> {
    before(capture.push({ id: 5, name: 'job' }));
    before(workers.once());

    it("should process that object", ()=>{
      let job = processed[0];
      assert.equal(job.id, 5);
      assert.equal(job.name, 'job');
    });

    after(()=> processed.length = 0);
  });


  describe("a string", ()=> {
    before(capture.push('job'));
    before(workers.once());

    it("should process that string", ()=>{
      let job = processed[0];
      assert.equal(job, 'job');
    });

    after(()=> processed.length = 0);
  });


  describe("a number", ()=> {
    before(capture.push(3.1));
    before(workers.once());

    it("should process that number", ()=>{
      let job = processed[0];
      assert.equal(job, 3.1);
    });

    after(()=> processed.length = 0);
  });


  describe("an array", ()=> {
    before(capture.push([true, '+']));
    before(workers.once());

    it("should process that array", ()=>{
      let job = processed[0];
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
      })
      assert(processed.length == 0);
      done();
    });
  });


  describe("as thunk", ()=> {
    let thunk;

    before(()=> {
      thunk = capture.push('thunk');
    });
    before(workers.once());

    it("should return a thunk", ()=> {
      assert(thunk);
      assert(typeof(thunk) == 'function');
    });

    it("should not queue until thunk called", (done)=>{
      process.nextTick(()=> {
        workers.once(()=>{
          assert(processed.length == 0);
          done();
        });
      });
    });

    describe("thunk called", ()=> {
      before((done)=> thunk(done));
      before(workers.once());

      it("should queue job", (done)=>{
        assert(processed.length == 1);
        done();
      });
    });

    after(()=> processed.length = 0);
  });

});
