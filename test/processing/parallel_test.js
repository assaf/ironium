'use strict';

const assert          = require('assert');
const Bluebird        = require('bluebird');
const getIronMQConfig = require('../iron_mq_config');
const Ironium         = require('../..');
const setup           = require('../helpers');


describe('Processing', function() {

  function createHandler(chain) {
    return function(job) {
      chain.push(job);
      return Bluebird.delay(10)
        .then(function() {
          chain.push(job);
        });
    };
  }

  before(setup);

  describe('serially', function() {
    let processSerialQueue;
    const chain = [];

    before(function() {
      const withoutConcurrency = Object.assign(getIronMQConfig(), { concurrency: 1 });
      Ironium.configure(withoutConcurrency);
      processSerialQueue = Ironium.queue(`process-serial-${Date.now()}`);
    });

    before(function() {
      processSerialQueue.eachJob(createHandler(chain));
    });

    before(function() {
      return Bluebird.each(['A', 'B'], job => processSerialQueue.queueJob(job));
    });

    before(Ironium.start);
    before(function(done) {
      setTimeout(done, 3000);
    });

    it('should run jobs in sequence', function() {
      assert.equal(chain.join(''), 'AABB');
    });

    after(Ironium.stop);
    after(function(done) {
      setTimeout(done, 100);
    });
  });


  describe('with concurrency - simple', function() {
    let processParallelQueue;
    const chain = [];

    before(function() {
      Ironium.configure(getIronMQConfig());
      processParallelQueue = Ironium.queue(`process-parallel-${Date.now()}`);
    });

    before(function() {
      processParallelQueue.eachJob(createHandler(chain));
    });

    before(function() {
      return Bluebird.each(['A', 'B'], job => processParallelQueue.queueJob(job));
    });

    before(Ironium.start);
    before(function(done) {
      setTimeout(done, 2000);
    });

    it('should run jobs in parallel', function() {
      assert.equal(chain.join(''), 'ABAB');
    });

    after(Ironium.stop);
    after(function(done) {
      setTimeout(done, 100);
    });
  });

});

