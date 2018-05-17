'use strict';

const assert   = require('assert');
const Ironium  = require('../..');
const setup    = require('../helpers');


describe('Processing only some queues', function() {
  let foos;
  let bars;

  before(setup);

  before(function() {
    process.env.IRONIUM_QUEUES = 'some-queues-foo';
    Ironium.configure({});
  });

  before(function() {
    foos = [];
    bars = [];

    Ironium.eachJob('some-queues-foo', function(job) {
      foos.push(job);
      return Promise.resolve();
    });

    Ironium.eachJob('some-queues-bar', function(job) {
      bars.push(job);
      return Promise.resolve();
    });
  });

  before(function() {
    return Promise.all([
      Ironium.queueJob('some-queues-foo', 1),
      Ironium.queueJob('some-queues-bar', 1)
    ]);
  });

  before(Ironium.start);

  before(function(done) {
    setTimeout(done, 1000);
  });

  it('should run jobs in the whitelisted queue', function() {
    assert.deepEqual(foos, [ 1 ]);
  });

  it('should not run jobs from other queues', function() {
    assert.deepEqual(bars, []);
  });

  describe('registering handler after start', function() {
    let bazs;

    before(function() {
      bazs = [];
      Ironium.eachJob('some-queues-baz', function(job) {
        bazs.push(job);
        return Promise.resolve();
      });
    });

    before(function() {
      return Ironium.queueJob('some-queues-baz', 1);
    });

    before(function(done) {
      setTimeout(done, 100);
    });

    it('should not run jobs from other queues', function() {
      assert.deepEqual(bazs, []);
    });
  });

  after(Ironium.stop);

  after(function(done) {
    setTimeout(done, 100);
  });

  after(function() {
    process.env.IRONIUM_QUEUES = '';
    Ironium.configure({});
  });
});


describe('Processing only some queues - configure with a function', function() {
  let bazs;
  let quxs;

  before(setup);

  before(function() {
    Ironium.configure({
      canStartQueue: function(queueName) {
        return queueName === 'some-queues-qux';
      }
    });
  });

  before(function() {
    bazs = [];
    quxs = [];

    Ironium.eachJob('some-queues-baz', function(job) {
      bazs.push(job);
      return Promise.resolve();
    });

    Ironium.eachJob('some-queues-qux', function(job) {
      quxs.push(job);
      return Promise.resolve();
    });
  });

  before(function() {
    return Promise.all([
      Ironium.queueJob('some-queues-baz', 1),
      Ironium.queueJob('some-queues-qux', 1)
    ]);
  });

  before(Ironium.start);

  before(function(done) {
    setTimeout(done, 1000);
  });

  it('should run jobs in the whitelisted queue', function() {
    assert.deepEqual(quxs, [ 1 ]);
  });

  it('should not run jobs from other queues', function() {
    assert.deepEqual(bazs, []);
  });

  after(Ironium.stop);

  after(function(done) {
    setTimeout(done, 100);
  });

  after(function() {
    Ironium.configure({});
  });
});
