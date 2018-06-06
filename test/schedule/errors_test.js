'use strict';

const assert     = require('assert');
const Ironium    = require('../..');
const ms         = require('ms');
const setup      = require('../helpers');
const TimeKeeper = require('timekeeper');


describe('Scheduled job with interval, failing', function() {
  let count = 0;

  before(setup);

  before(function() {
    TimeKeeper.travel('2015-06-29T20:16:00Z');
    Ironium.scheduleJob('every-5m', '5m', function() {
      // Fails the first time.
      count++;
      if (count === 1)
        return Promise.reject(new Error('Transient'));
      else
        return Promise.resolve();
    });
  });

  describe('on first occurrence', function() {
    before(function() {
      TimeKeeper.travel(Date.now() + ms('5m'));
    });
    before(function() {
      return Ironium.runOnce().catch(function() {});
    });

    it('should have run scheduled job once', function() {
      assert.equal(count, 1);
    });

    describe('on second occurrence', function() {
      before(function() {
        TimeKeeper.travel(Date.now() + ms('5m'));
      });
      before(Ironium.runOnce);

      it('should run the scheduled job only once more', function() {
        assert.equal(count, 2);
      });
    });

    after(TimeKeeper.reset);
  });
});


describe('One-off scheduled job, failing', function() {
  let count = 0;

  before(setup);

  before(function() {
    TimeKeeper.travel('2015-06-29T20:00:00Z');
    Ironium.scheduleJob('one-off', new Date('2015-06-29T21:00:00Z'), function() {
      // Fails the first time.
      count++;
      if (count === 1)
        return Promise.reject(new Error('Transient'));
      else
        return Promise.resolve();
    });
  });

  describe('when due', function() {
    before(function() {
      TimeKeeper.travel(new Date('2015-06-29T21:01:00Z'));
    });
    before(function() {
      return Ironium.runOnce().catch(function() {});
    });

    it('should have run scheduled job once', function() {
      assert.equal(count, 1);
    });

    describe('after a while', function() {
      before(function() {
        TimeKeeper.travel(Date.now() + ms('5m'));
      });
      before(Ironium.runOnce);

      it('should run scheduled job again', function() {
        assert.equal(count, 2);
      });
    });

    after(TimeKeeper.reset);
  });
});
