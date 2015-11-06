'use strict';
require('../helpers');
const assert     = require('assert');
const Ironium    = require('../..');
const ms         = require('ms');
const TimeKeeper = require('timekeeper');


describe('Scheduled job', ()=> {

  let delta;

  before((done)=> {
    const t1 = Date.now();

    Ironium.scheduleJob('in-2s', new Date(Date.now() + ms('2s')), function(callback) {
      delta = Date.now() - t1;
      Ironium.stop();
      setTimeout(done, 100);
      callback();
    });

    Ironium.start();
  });

  it('should not be run job before scheduled time', function() {
    assert(delta > 2000);
  });

});


describe('Scheduled job with start time and interval', ()=> {

  let count = 0;

  before(()=> {
    TimeKeeper.travel('2015-06-29T20:16:00Z');
    const options = {
      // Run every hour, at 13 minutes, 15 seconds on the hour
      start:  new Date(null, null, null, null, 13, 15),
      every:  '1h'
    };
    Ironium.scheduleJob('start-and-interval', options, function(callback) {
      count++;
      callback();
    });
  });

  describe('runOnce', ()=> {

    describe('before first occurrence', ()=> {

      before(()=> {
        TimeKeeper.travel( new Date('2015-06-30T20:13:14Z') );
        Ironium.resetSchedule();
      });
      before(Ironium.runOnce);

      it('should not run job', ()=> {
        assert.equal(count, 0);
      });

    });

    describe('after first occurrence', ()=> {
      before(()=> {
        TimeKeeper.travel( new Date('2015-06-30T20:13:16Z') );
      });
      before(Ironium.runOnce);

      it('should run the job once', ()=> {
        assert.equal(count, 1);
      });


      describe('wait a little', ()=> {

        before(()=> {
          TimeKeeper.travel(Date.now() + ms('30m'));
        });

        before(Ironium.runOnce);

        it('should not run job again', ()=> {
          assert.equal(count, 1);
        });


        describe('after second occurence', ()=> {

          before(()=> {
            TimeKeeper.travel(Date.now() + ms('31m'));
          });

          before(Ironium.runOnce);

          it('should run the job again', ()=> {
            assert.equal(count, 2);
          });


          describe('after rewinding clock resetting schedule', ()=> {

            before(()=> {
              TimeKeeper.travel( new Date('2015-06-30T20:13:16Z') );
            });
            before(Ironium.resetSchedule);

            before(()=> {
              TimeKeeper.travel(Date.now() + ms('1h'));
            });
            before(Ironium.runOnce);

            it('should run the job again', ()=> {
              assert.equal(count, 3);
            });

            after(TimeKeeper.reset);
          });


        });

      });

    });

  });

});

