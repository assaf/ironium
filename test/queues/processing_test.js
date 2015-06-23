require('../helpers');
const assert  = require('assert');
const Ironium = require('../../src');
const Promise = require('bluebird');


describe('processing', ()=> {

  const processMultipleQueue   = Ironium.queue('process-multiple');
  const processPromiseQueue    = Ironium.queue('process-promise');
  const processGeneratorQueue  = Ironium.queue('process-generator');
  const processOnceAQueue      = Ironium.queue('process-once-a');
  const processOnceBQueue      = Ironium.queue('process-once-b');


  describe('with multiple handlers', ()=> {

    // Count how many steps run
    const steps = [];
    before(()=> {
      processMultipleQueue.eachJob((job, callback)=> {
        steps.push('A');
        callback();
      });
      processMultipleQueue.eachJob((job, callback)=> {
        steps.push('B');
        callback();
      });
      processMultipleQueue.eachJob((job, callback)=> {
        steps.push('C');
        callback();
      });
    });

    before(()=> processMultipleQueue.pushJob('job'));
    before(Ironium.runOnce);

    it('should run all steps', ()=> {
      assert.equal(steps.join(''), 'ABC');
    });

  });


  describe('with promises', ()=> {

    // Count how many steps run
    const steps = [];
    before(()=> {
      processPromiseQueue.eachJob(()=> {
        const promise = new Promise(setImmediate);
        return promise
          .then(()=> steps.push('A'))
          .then(()=> steps.push('B'))
          .then(()=> steps.push('C'));
      });
    });

    before(()=> processPromiseQueue.pushJob('job'));
    before(Ironium.runOnce);

    it('should run all steps', ()=> {
      assert.equal(steps.join(''), 'ABC');
    });

  });


  describe('with generator', ()=> {

    // Count how many steps run
    const steps = [];
    before(()=> {
      processGeneratorQueue.eachJob(function*() {
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

    before(()=> processGeneratorQueue.pushJob('job'));
    before(Ironium.runOnce);

    it('should run all steps', ()=> {
      assert.equal(steps.join(''), 'ABC');
    });

  });


  describe('with async/await', ()=> {

    // Count how many steps run
    const steps = [];
    before(()=> {
      processGeneratorQueue.eachJob(async function() {
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

    before(()=> processGeneratorQueue.pushJob('job'));
    before(Ironium.runOnce);

    it('should run all steps', ()=> {
      assert.equal(steps.join(''), 'ABC');
    });

  });



  describe('once', ()=> {
    // Count how many steps run
    const steps = [];
    before(()=> {
      // Process A, queue job for B
      // Process B, queue job for A
      // Process A, nothing more
      processOnceAQueue.eachJob(function(job, callback) {
        steps.push('A');
        if (steps.length == 1)
          processOnceBQueue.pushJob('job', callback);
        else
          callback();
      });
      processOnceBQueue.eachJob(function(job, callback) {
        steps.push('B');
        processOnceAQueue.pushJob('job', callback);
      });
    });

    before(()=> processOnceAQueue.pushJob('job'));
    before(Ironium.runOnce);

    it('should run all jobs to completion', ()=> {
      assert.equal(steps.join(''), 'ABA');
    });
  });

});

