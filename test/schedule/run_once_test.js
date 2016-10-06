'use strict';
require('../helpers');
const assert     = require('assert');
const Ironium    = require('../..');
const ms         = require('ms');
const TimeKeeper = require('timekeeper');


describe('Scheduled job with interval', function() {

  let count = 0;

  before(Ironium.purgeQueues);

  before(function() {
    TimeKeeper.travel('2015-06-29T20:16:00Z');
    Ironium.scheduleJob('every-1hr', '1h', function() {
      count++;
      return Promise.resolve();
    });
  });

  describe('runOnce', function() {

    describe('before first occurrence', function() {

      before(Ironium.runOnce);

      it('should not run job', function() {
        assert.equal(count, 0);
      });

    });

    describe('after first occurrence', function() {
      before(function() {
        TimeKeeper.travel(Date.now() + ms('1h'));
      });

      before(Ironium.runOnce);

      it('should run the job once', function() {
        assert.equal(count, 1);
      });


      describe('wait a little', function() {

        before(function() {
          TimeKeeper.travel(Date.now() + ms('30m'));
        });

        before(Ironium.runOnce);

        it('should not run job again', function() {
          assert.equal(count, 1);
        });


        describe('after second occurence', function() {

          before(function() {
            TimeKeeper.travel(Date.now() + ms('31m'));
          });

          before(Ironium.runOnce);

          it('should run the job again', function() {
            assert.equal(count, 2);
          });

          describe('after rewinding clock resetting schedule', function() {

            before(function() {
              TimeKeeper.travel('2015-06-29T20:00:00Z');
            });
            before(Ironium.resetSchedule);

            before(function() {
              TimeKeeper.travel(Date.now() + ms('1h'));
            });
            before(Ironium.runOnce);

            it('should run the job again', function() {
              assert.equal(count, 3);
            });

            after(TimeKeeper.reset);
          });

        });

      });

    });

  });

});


describe('Scheduled job with errors', function() {

  let fail = false;

  before(function() {
    TimeKeeper.travel('2015-06-29T20:16:00Z');
    Ironium.scheduleJob('fail-every-1hr', '1h', function() {
      if (fail)
        return Promise.reject(new Error('Failing'));
      else
        return Promise.resolve();
    });
  });

  describe('runOnce', function() {
    before(function() {
      fail = true;
      TimeKeeper.travel(Date.now() + ms('1h'));
    });

    it('should throw', function(done) {
      Ironium.runOnce()
        .then(function() {
          done(new Error('Did not throw'));
        })
        .catch(function(err) {
          assert.equal(err.message, 'Failing');
          done();
        });
    });

    after(function() {
      // Let other tests pass.
      fail = false;
    });
  });

});
