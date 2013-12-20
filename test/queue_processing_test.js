const assert  = require('assert');
const Helpers = require('./helpers');
const workers = require('../src');


describe("processing", ()=> {

  const processMultiple   = workers.queue('process-multiple');
  const processPromise    = workers.queue('process-promise');
  const processGenerator  = workers.queue('process-generator');

  // Empty all queues.
  before((done)=> workers.reset(done));


  describe("with multiple handlers", ()=> {

    // Count how many steps run
    let steps = 0;
    before(()=> {
      processMultiple.each((job, callback)=> {
        steps++;
        callback();
      });
      processMultiple.each((job, callback)=> {
        steps++;
        callback();
      });
      processMultiple.each((job, callback)=> {
        steps++;
        callback();
      });
    });

    before((done)=> processMultiple.push('bandito', done));
    before((done)=> workers.once(done));

    it("should run all steps", ()=> {
      assert.equal(steps, 3);
    });

  });


  describe("with promises", ()=> {

    // Count how many steps run
    let steps = 0;
    before(()=> {
      processPromise.each((job)=> {
        let promise = new Promise((resolve, reject)=> {
          setTimeout(resolve, 10);
        });
        promise
          .then(()=> steps++)
          .then(()=> steps++)
          .then(()=> steps++);
        return promise;
      });
    });

    before((done)=> processPromise.push('bandito', done));
    before((done)=> workers.once(done));

    it("should run all steps", ()=> {
      assert.equal(steps, 3);
    });

  });


  describe("with generator", ()=> {

    // Count how many steps run
    let steps = 0;
    before(()=> {
      processGenerator.each(function*(job) {
        steps++;
        yield Promise.resolve();
        steps++;
        yield (done)=> done();
        steps++;
      });
    });

    before((done)=> processGenerator.push('bandito', done));
    before((done)=> workers.once(done));

    it("should run all steps", ()=> {
      assert.equal(steps, 3);
    });

  });

});


