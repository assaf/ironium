const assert  = require('assert');
const Helpers = require('../helpers');
const ironium = require('../../src');


describe.skip("processing", ()=> {

  const processSerial     = ironium.queue('process-serial');
  const processParallel   = ironium.queue('process-parallel');


  describe("with one worker", ()=> {

    // Count how many steps run
    let chain = [];
    before(()=> {
      processSerial.each((job, callback)=> {
        chain.push('A');
        setTimeout(()=> {
          chain.push('B');
          callback();
        }, 10);
      });
    });

    before(()=> processSerial.push(1));
    before(()=> processSerial.push(2));
    before(()=> ironium.once());

    it("should run jobs in sequence", ()=> {
      assert.equal(chain.join(''), 'ABAB');
    });

  });


  describe("with two workers", ()=> {

    // Count how many steps run
    let chain = [];
    before(()=> {
      processParallel.each((job, callback)=> {
        chain.push('A');
        setTimeout(()=> {
          chain.push('B');
          callback();
        }, 10);
      }, 2);
    });

    before(()=> processParallel.push(3));
    before(()=> processParallel.push(4));
    before(()=> ironium.once());

    it("should run jobs in sequence", ()=> {
      assert.equal(chain.join(''), 'AABB');
    });

  });

});

