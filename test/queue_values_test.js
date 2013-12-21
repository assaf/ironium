const assert  = require('assert');
const Helpers = require('./helpers');
const workers = require('../src');


describe("queue", ()=> {

  const capture = workers.queue('capture');

  // Empty all queues.
  before((done)=> workers.reset(done));

  // Capture processed jobs here.
  let processed = [];

  before(function() {
    capture.each((job, callback)=> {
      processed.push(job);
      callback();
    });
  });


  describe("an object", ()=> {
    before((done)=> capture.push({ id: 5, name: 'bandito' }, done));
    before((done)=> workers.once(done));

    it("should process that object", ()=>{
      let job = processed[0];
      assert.equal(job.id, 5);
      assert.equal(job.name, 'bandito');
    });

    after(()=> processed.length = 0);
  });


  describe("a string", ()=> {
    before((done)=> capture.push('bandito', done));
    before((done)=> workers.once(done));

    it("should process that string", ()=>{
      let job = processed[0];
      assert.equal(job, 'bandito');
    });

    after(()=> processed.length = 0);
  });


  describe("a number", ()=> {
    before((done)=> capture.push(3.1, done));
    before((done)=> workers.once(done));

    it("should process that number", ()=>{
      let job = processed[0];
      assert.equal(job, 3.1);
    });

    after(()=> processed.length = 0);
  });


  describe("an array", ()=> {
    before((done)=> capture.push([true, '+'], done));
    before((done)=> workers.once(done));

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


  describe("as promise", ()=> {
    let promise;

    before(()=> {
      promise = capture.push('promise');
    });
    before((done)=> workers.once(done));

    it("should return a promise", ()=> {
      assert(promise);
      assert(typeof(promise.then) == 'function');
      assert(typeof(promise.catch) == 'function');
    });

    it("should resolve promise with job ID", (done)=> {
      promise.then((id)=> {
        assert(/\d+/.test(id));
        done();
      }, done);
    });

    after(()=> processed.length = 0);
  });


  after((done)=> workers.reset(done));
});
