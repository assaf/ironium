'use strict';
require('../helpers');
const assert   = require('assert');
const Bluebird = require('bluebird');
const Ironium  = require('../..');


describe('Processing', ()=> {

  const processSerialQueue   = Ironium.queue('process-serial');
  const processParallelQueue = Ironium.queue('process-parallel');

  function createHandler(chain) {
    return function(job) {
      chain.push('A');
      return Bluebird.delay(10)
        .then(() => {
          chain.push('B');
        });
    };
  }


  describe('serially', ()=> {
    const chain = [];

    before(()=> {
      Ironium.configure({ concurrency: 1 });
      processSerialQueue.eachJob(createHandler(chain));
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


  describe('with default concurrency', ()=> {
    const chain = [];

    before(Ironium.purgeQueues);
    before(()=> {
      Ironium.configure({});
      processParallelQueue.eachJob(createHandler(chain));
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

