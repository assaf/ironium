'use strict';

const assert   = require('assert');
const Bluebird = require('bluebird');
const Ironium  = require('../..');
const setup    = require('../helpers');


describe('Processing only some queues', function() {
  let foos;
  let bars;

  before(setup);

  before(function() {
    Ironium.configure({ queues: [ 'some-queues-foo' ] });
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
    Ironium.configure({});
  });
});
