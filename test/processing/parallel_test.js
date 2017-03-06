'use strict';
require('../helpers');
const assert   = require('assert');
const Bluebird = require('bluebird');
const File     = require('fs');
const Ironium  = require('../..');


describe('Processing', function() {
  let ironMQConfig;


  function createHandler(chain) {
    return function(job) {
      chain.push(job);
      return Bluebird.delay(10)
        .then(function() {
          chain.push(job);
        });
    };
  }

  before(function() {
    ironMQConfig = JSON.parse(File.readFileSync('iron.json'));
  });


  describe('serially', function() {
    let processSerialQueue;
    const chain = [];

    before(function() {
      const withoutConcurrency = Object.assign({}, ironMQConfig, { concurrency: 1 });
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
      Ironium.configure(ironMQConfig);
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

