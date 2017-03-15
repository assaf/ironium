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
      return Ironium.runOnce().catch(function() {})
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
