'use strict';
require('../helpers');
const assert   = require('assert');
const Bluebird = require('bluebird');
const File     = require('fs');
const Ironium  = require('../..');


describe('Processing', () => {
  let ironMQConfig;


  function createHandler(chain) {
    return function(job) {
      chain.push(job);
      return Bluebird.delay(10)
        .then(() => {
          chain.push(job);
        });
    };
  }

  before(function() {
    ironMQConfig = JSON.parse(File.readFileSync('iron.json'));
  });


  describe('serially', () => {
    let processSerialQueue;
    const chain = [];

    before(() => {
      const withoutConcurrency = Object.assign({}, ironMQConfig, { concurrency: 1 });
      Ironium.configure(withoutConcurrency);
      processSerialQueue = Ironium.queue(`process-serial-${Date.now()}`);
    });

    before(() => {
      processSerialQueue.eachJob(createHandler(chain));
    });

    before(function() {
      return Bluebird.each(['A', 'B'], job => processSerialQueue.queueJob(job));
    });

    before(Ironium.start);
    before((done) => setTimeout(done, 2000));

    it('should run jobs in sequence', () => {
      assert.equal(chain.join(''), 'AABB');
    });

    after(Ironium.stop);
    after(function(done) {
      setTimeout(done, 100);
    });
  });


  describe('with concurrency - simple', () => {
    let processParallelQueue;
    const chain = [];

    before(() => {
      Ironium.configure(ironMQConfig);
      processParallelQueue = Ironium.queue(`process-parallel-${Date.now()}`);
    });

    before(() => {
      processParallelQueue.eachJob(createHandler(chain));
    });

    before(function() {
      return Bluebird.each(['A', 'B'], job => processParallelQueue.queueJob(job));
    });

    before(Ironium.start);
    before(done => setTimeout(done, 2000));

    it('should run jobs in parallel', () => {
      assert.equal(chain.join(''), 'ABAB');
    });

    after(Ironium.stop);
    after(function(done) {
      setTimeout(done, 100);
    });
  });


  describe('with concurrency - throttled', () => {
    let processParallelQueue;
    const chain = [];

    before(() => {
      const withLimitedConcurrency = Object.assign({}, ironMQConfig, { concurrency: 2 });
      Ironium.configure(withLimitedConcurrency);
      processParallelQueue = Ironium.queue(`process-parallel-${Date.now()}`);
    });

    before(() => {
      processParallelQueue.eachJob(createHandler(chain));
    });

    before(function() {
      const jobs = [1, 2, 3, 4, 5, 6];
      return Bluebird.each(jobs, job => processParallelQueue.queueJob(job));
    });

    before(Ironium.start);
    before(done => setTimeout(done, 4000));

    it('should run jobs in parallel', () => {
      assert(chain.join('').startsWith('12123434'));
    });

    after(Ironium.stop);
    after(done => setTimeout(done, 100));
  });


  after(function() {
    Ironium.configure({});
  });

});

