'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');


describe('Processing', ()=> {

  const processSerialQueue   = Ironium.queue('process-serial');
  const processParallelQueue = Ironium.queue('process-parallel');

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
    before(Ironium.start);
    before((done)=> setTimeout(done, 100));

    it('should run jobs in sequence', ()=> {
      assert.equal(chain.join(''), 'ABAB');
    });

    after(Ironium.stop);
    after(function(done) {
      setTimeout(done, 100);
    });
  });


  describe('with two workers', ()=> {

    before(()=> {
      chain.length = 0;
      processParallelQueue.eachJob(worker, 2);
    });
    before(function() {
      const jobs = [3, 4].map((job)=> processParallelQueue.queueJob(job));
      return Promise.all(jobs);
    });
    before(Ironium.start);
    before((done)=> setTimeout(done, 100));

    it('should run jobs in parallel', ()=> {
      assert.equal(chain.join(''), 'AABB');
    });

    after(Ironium.stop);
    after(function(done) {
      setTimeout(done, 100);
    });
  });

});

