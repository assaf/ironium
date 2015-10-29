require('../helpers');
const assert     = require('assert');
const Ironium    = require('../../src');
const ms         = require('ms');
const TimeKeeper = require('timekeeper');


describe('Scheduled job with interval', ()=> {

  let count = 0;

  before(()=> {
    TimeKeeper.travel('2015-06-29T20:16:00Z');
    Ironium.scheduleJob('every-1hr', '1h', async function() {
      count++;
    });
  });

  describe('runOnce', ()=> {

    describe('before first occurrence', ()=> {

      before(Ironium.runOnce);

      it('should not run job', ()=> {
        assert.equal(count, 0);
      });

    });

    describe('after first occurrence', ()=> {
      before(()=> {
        TimeKeeper.travel(Date.now() + ms('1h'));
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
              TimeKeeper.travel('2015-06-29T20:00:00Z');
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

