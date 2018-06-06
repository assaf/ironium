'use strict';

const assert  = require('assert');
const Ironium = require('../..');
const setup   = require('../helpers');


describe('Processing only some schedules', function() {
  let bazs;
  let quxs;

  before(setup);

  before(function() {
    Ironium.configure({
      canStartQueue: function(queueName) {
        return queueName === 'some-schedules-qux';
      }
    });
  });

  before(function() {
    bazs = [];
    quxs = [];

    Ironium.scheduleJob('some-schedules-baz', '1m', function(job) {
      bazs.push(job);
      return Promise.resolve();
    });

    Ironium.scheduleJob('some-schedules-qux', '1m', function(job) {
      quxs.push(job);
      return Promise.resolve();
    });
  });

  before(Ironium.start);

  before(function(done) {
    setTimeout(done, 1000);
  });

  it('should have started the whitelisted schedule', function() {
    const schedule = Ironium._scheduler._schedules.get('some-schedules-qux');
    assert(schedule._timeout);
  });

  it('should not have started the other schedule', function() {
    const schedule = Ironium._scheduler._schedules.get('some-schedules-baz');
    assert(!schedule._timeout);
  });

  after(Ironium.stop);

  after(function(done) {
    setTimeout(done, 100);
  });

  after(function() {
    Ironium.configure({});
  });
});
