'use strict';

const assert          = require('assert');
const Crypto          = require('crypto');
const getAWSConfig    = require('../aws_config');
const getIronMQConfig = require('../iron_mq_config');
const Ironium         = require('../..');
const setup           = require('../helpers');


describe('Running a job with errors', function() {

  let errorQueue;

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
    errorQueue = Ironium.queue('error');
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


(getIronMQConfig.isAvailable ? describe : describe.skip)('Running a job with errors - IronMQ', function() {
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
    Ironium.configure(getIronMQConfig());
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
    setTimeout(done, 3000);
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


(getAWSConfig.isAvailable ? describe : describe.skip)('Running a job with errors - SQS', function() {
  const randomJobID = Crypto.randomBytes(256).toString('hex');
  let errorQueue;
  let runs;

  function countAndFailJob(job) {
    if (job.id === randomJobID) {
      runs++;
      return Promise.reject(new Error('fail'));
    } else
      return Promise.resolve();
  }

  before(setup);

  before(function() {
    runs = 0;
  });

  before(function() {
    Ironium.configure(getAWSConfig());
  });
  before(function() {
    errorQueue = Ironium.queue('error-other');
    errorQueue.eachJob(countAndFailJob);
  });
  before(function() {
    return errorQueue.queueJob({ id: randomJobID });
  });
  before(function(done) {
    process.env.NODE_ENV = 'production';
    Ironium.start();
    setTimeout(done, 3000);
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
