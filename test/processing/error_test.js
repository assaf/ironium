'use strict';

const assert  = require('assert');
const File    = require('fs');
const Ironium = require('../..');
const setup   = require('../helpers');


describe('Running a job with errors', function() {

  const errorQueue = Ironium.queue('error');

  // First two runs should fail, runs ends at 3
  let runs;

  function countAndFailJob() {
    runs++;
    if (runs > 2)
      return Promise.resolve();
    else
      return Promise.reject(new Error('fail'));
  }

  before(setup);
  before(function() {
    errorQueue.eachJob(countAndFailJob);
  });

  describe('continuously', function() {

    before(function() {
      runs = 0;
    });

    before(function() {
      Ironium.configure({ concurrency: 1 });
    });
    before(Ironium.purgeQueues);
    before(function() {
      return errorQueue.queueJob('job');
    });
    before(Ironium.start);
    before(done => setTimeout(done, 1500));

    it('should run three times until successful', function() {
      assert.equal(runs, 3);
    });

    after(function() {
      Ironium.configure({});
      Ironium.stop();
    });

  });

  describe('once', function() {

    before(function() {
      runs = 0;
    });
    before(Ironium.purgeQueues);
    before(function() {
      return errorQueue.queueJob('job');
    });

    it('should reject the promise', function() {
      return Ironium.runOnce()
        .catch(function(error) {
          return error;
        })
        .then(function(error) {
          assert.equal(error.message, 'fail');
        });
    });

    after(Ironium.purgeQueues);

  });

});


describe('Running a job with errors - IronMQ', function() {
  let errorQueue;
  let runs;

  function countAndFailJob() {
    runs++;
    return Promise.reject(new Error('fail'));
  }

  before(setup);

  before(function() {
    runs = 0;
  });

  before(function() {
    const ironMQConfig = JSON.parse(File.readFileSync('iron.json'));
    Ironium.configure(Object.assign({}, ironMQConfig, { concurrency: 1 }));
  });
  before(function() {
    errorQueue = Ironium.queue('error-other');
    errorQueue.eachJob(countAndFailJob);
  });
  before(Ironium.purgeQueues);
  before(function() {
    return errorQueue.queueJob('job');
  });
  before(function(done) {
    process.env.NODE_ENV = 'production';
    Ironium.start();
    setTimeout(done, 2000);
  });

  it('should return the job back to the queue with a delay', function() {
    // Only 1 run.
    assert.equal(runs, 1);
  });

  after(function() {
    process.env.NODE_ENV = 'test';
    Ironium.stop();
    Ironium.configure({});
  });
});

