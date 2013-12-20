const assert  = require('assert');
const Helpers = require('./helpers');
const workers = require('../src');


describe("processing", ()=> {

  const processSerial     = workers.queue('process-serial');
  const processParallel   = workers.queue('process-parallel');

  // Empty all queues.
  before((done)=> workers.reset(done));


  describe("with one worker", ()=> {

    // Count how many steps run
    let chain = [];
    before(()=> {
      processSerial.each((job, callback)=> {
        chain.push('A');
        setTimeout(()=> {
          chain.push('B');
          callback();
        }, 1);
      });
    });

    before((done)=> processSerial.push(1, done));
    before((done)=> processSerial.push(2, done));
    before((done)=> workers.once(done));

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

    before((done)=> processParallel.push(3, done));
    before((done)=> processParallel.push(4, done));
    before((done)=> workers.once(done));

    it("should run jobs in parallel", ()=> {
      assert.equal(chain.join(''), 'AABB');
    });

  });

});

