require('../helpers');
const assert  = require('assert');
const ironium = require('../../src');


describe('processing', ()=> {

  const processSerialQueue   = ironium.queue('process-serial');
  const processParallelQueue = ironium.queue('process-parallel');


  describe('with one worker', ()=> {

    // Count how many steps run
    const chain = [];
    before(()=> {
      processSerialQueue.eachJob((job, callback)=> {
        chain.push('A');
        setTimeout(()=> {
          chain.push('B');
          callback();
        }, 10);
      });
    });

    before(()=> processSerialQueue.pushJob(1));
    before(()=> processSerialQueue.pushJob(2));
    before(ironium.runOnce);

    it('should run jobs in sequence', ()=> {
      assert.equal(chain.join(''), 'ABAB');
    });

  });


  describe.skip('with two workers', ()=> {

    // Count how many steps run
    const chain = [];
    before(()=> {
      processParallelQueue.eachJob((job, callback)=> {
        chain.push('A');
        setTimeout(()=> {
          chain.push('B');
          callback();
        }, 10);
      }, 2);
    });

    before(()=> processParallelQueue.pushJob(3));
    before(()=> processParallelQueue.pushJob(4));
    before(ironium.runOnce);

    it('should run jobs in sequence', ()=> {
      assert.equal(chain.join(''), 'AABB');
    });

  });

});

