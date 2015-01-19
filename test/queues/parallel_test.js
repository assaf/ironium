require('../helpers');
const assert  = require('assert');
const ironium = require('../../src');


describe('processing', ()=> {

  const processSerialQueue   = ironium.queue('process-serial');
  const processParallelQueue = ironium.queue('process-parallel');

  // Count how many steps run
  const chain = [];

  function worker(job, callback) {
    chain.push('A');
    setTimeout(()=> {
      chain.push('B');
      callback();
    }, 10);
  }


  describe('with one worker', ()=> {

    before(()=> {
      chain.length = 0;
      processSerialQueue.eachJob(worker);
    });
    before(function() {
      const jobs = [1, 2].map((job)=> processSerialQueue.queueJob(job));
      return Promise.all(jobs);
    });
    before(ironium.start);
    before((done)=> setTimeout(done, 50));

    it('should run jobs in sequence', ()=> {
      assert.equal(chain.join(''), 'ABAB');
    });

    after(ironium.stop);
  });


  describe.skip('with two workers', ()=> {

    before(()=> {
      chain.length = 0;
      processParallelQueue.eachJob(worker, 2);
    });
    before(function() {
      const jobs = [3, 4].map((job)=> processSerialQueue.queueJob(job));
      return Promise.all(jobs);
    });
    before(ironium.start);
    before((done)=> setTimeout(done, 50));

    it('should run jobs in sequence', ()=> {
      assert.equal(chain.join(''), 'AABB');
    });

    after(ironium.stop);
  });

});

