const assert      = require('assert');
const Helpers     = require('./helpers');
const { Promise } = require('es6-promise');
const workers     = require('../src');


describe("processing", ()=> {

  const processMultiple   = workers.queue('process-multiple');
  const processPromise    = workers.queue('process-promise');
  const processGenerator  = workers.queue('process-generator');

  // Empty all queues.
  before((done)=> workers.reset(done));


  describe("with multiple handlers", ()=> {

    // Count how many steps run
    let steps = [];
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

    before((done)=> processMultiple.push('bandito', done));
    before((done)=> workers.once(done));

    it("should run all steps", ()=> {
      assert.equal(steps.join(''), 'ABC');
    });

  });


  describe("with promises", ()=> {

    // Count how many steps run
    let steps = [];
    before(()=> {
      processPromise.each((job)=> {
        let promise = new Promise(setImmediate);
        promise
          .then(()=> steps.push('A'))
          .then(()=> steps.push('B'))
          .then(()=> steps.push('C'));
        return promise;
      });
    });

    before((done)=> processPromise.push('bandito', done));
    before((done)=> workers.once(done));

    it("should run all steps", ()=> {
      assert.equal(steps.join(''), 'ABC');
    });

  });


  describe("with generator", ()=> {

    // Count how many steps run
    let steps = [];
    before(()=> {
      processGenerator.each(function*(job) {
        var one = yield Promise.resolve('A');
        steps.push(one);
        var two = yield (done)=> done(null, 'B');
        steps.push(two);
        var three = yield* function*() {
          yield setImmediate;
          return 'C';
        }();
        steps.push(three);
      });
    });

    before((done)=> processGenerator.push('bandito', done));
    before((done)=> workers.once(done));

    it("should run all steps", ()=> {
      assert.equal(steps.join(''), 'ABC');
    });

  });

  after((done)=> workers.reset(done));
});

