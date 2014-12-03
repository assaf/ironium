require('../helpers');
const assert  = require('assert');
const ironium = require('../../src');
const Promise = require('bluebird');


describe("processing", ()=> {

  const processMultiple   = ironium.queue('process-multiple');
  const processPromise    = ironium.queue('process-promise');
  const processGenerator  = ironium.queue('process-generator');
  const processOnceA      = ironium.queue('process-once-a');
  const processOnceB      = ironium.queue('process-once-b');


  describe("with multiple handlers", ()=> {

    // Count how many steps run
    const steps = [];
    before(()=> {
      processMultiple.each((job, callback)=> {
        steps.push('A');
        callback();
      });
      processMultiple.each((job, callback)=> {
        steps.push('B');
        callback();
      });
      processMultiple.each((job, callback)=> {
        steps.push('C');
        callback();
      });
    });

    before(()=> processMultiple.push('job'));
    before(ironium.once);

    it("should run all steps", ()=> {
      assert.equal(steps.join(''), 'ABC');
    });

  });


  describe("with promises", ()=> {

    // Count how many steps run
    const steps = [];
    before(()=> {
      processPromise.each(()=> {
        const promise = new Promise(setImmediate);
        return promise
          .then(()=> steps.push('A'))
          .then(()=> steps.push('B'))
          .then(()=> steps.push('C'));
      });
    });

    before(()=> processPromise.push('job'));
    before(ironium.once);

    it("should run all steps", ()=> {
      assert.equal(steps.join(''), 'ABC');
    });

  });


  describe("with generator", ()=> {

    // Count how many steps run
    const steps = [];
    before(()=> {
      processGenerator.each(function*() {
        const one = yield Promise.resolve('A');
        steps.push(one);
        const two = yield (done)=> done(null, 'B');
        steps.push(two);
        const three = yield* (function*() {
          yield setImmediate;
          return 'C';
        })();
        steps.push(three);
      });
    });

    before(()=> processGenerator.push('job'));
    before(ironium.once);

    it("should run all steps", ()=> {
      assert.equal(steps.join(''), 'ABC');
    });

  });


  describe("with async/await", ()=> {

    // Count how many steps run
    const steps = [];
    before(()=> {
      processGenerator.each(async function() {
        const one = await Promise.resolve('A');
        steps.push(one);
        const two = await Promise.resolve('B');
        steps.push(two);
        const three = await function() {
          return Promise.resolve('C');
        }();
        steps.push(three);
      });
    });

    before(()=> processGenerator.push('job'));
    before(ironium.once);

    it("should run all steps", ()=> {
      assert.equal(steps.join(''), 'ABC');
    });

  });



  describe("once", ()=> {
    // Count how many steps run
    const steps = [];
    before(()=> {
      // Process A, queue job for B
      // Process B, queue job for A
      // Process A, nothing more
      processOnceA.each(function(job, callback) {
        steps.push('A');
        if (steps.length == 1)
          processOnceB.push('job', callback);
        else
          callback();
      });
      processOnceB.each(function(job, callback) {
        steps.push('B');
        processOnceA.push('job', callback);
      });
    });

    before(()=> processOnceA.push('job'));
    before(ironium.once);

    it("should run all jobs to completion", ()=> {
      assert.equal(steps.join(''), 'ABA');
    });
  });

});

