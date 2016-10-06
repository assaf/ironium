'use strict';
require('../helpers');
const assert     = require('assert');
const Ironium    = require('../..');
const ms         = require('ms');
const TimeKeeper = require('timekeeper');


describe('Scheduled job', function() {

  let delta;

  before(function(done) {
    const t1 = Date.now();

    Ironium.scheduleJob('in-2s', new Date(Date.now() + ms('2s')), function() {
      delta = Date.now() - t1;
      Ironium.stop();
      setTimeout(done, 100);
      return Promise.resolve();
    });

    Ironium.start();
  });

  it('should not be run job before scheduled time', function() {
    assert(delta > 2000);
  });

});


describe('Scheduled job with start time and interval', function() {

  let count = 0;

  before(function() {
    TimeKeeper.travel('2015-06-29T20:16:00Z');
    const options = {
      // Run every hour, at 13 minutes, 15 seconds on the hour
      start:  new Date(null, null, null, null, 13, 15),
      every:  '1h'
    };
    Ironium.scheduleJob('start-and-interval', options, function() {
      count++;
      return Promise.resolve();
    });
  });

  describe('runOnce', function() {

    describe('before first occurrence', function() {

      before(function() {
        TimeKeeper.travel( new Date('2015-06-30T20:13:14Z') );
        Ironium.resetSchedule();
      });
      before(Ironium.runOnce);

      it('should not run job', function() {
        assert.equal(count, 0);
      });

    });

    describe('after first occurrence', function() {
      before(function() {
        TimeKeeper.travel( new Date('2015-06-30T20:13:16Z') );
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
              TimeKeeper.travel( new Date('2015-06-30T20:13:16Z') );
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

