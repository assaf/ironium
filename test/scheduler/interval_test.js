require('../helpers');
const assert     = require('assert');
const Ironium    = require('../../src');
const net        = require('net');
const TimeKeeper = require('timekeeper');


describe('Scheduled job with intervals', ()=> {

  describe('runOnce', ()=> {

    let count = 0;

    before(()=> {
      Ironium.scheduleJob('every-1hr', '1h', function() {
        count++;
        return Promise.resolve();
      });
    });

    before(Ironium.runOnce);

    it('should not run job before interval is due', ()=> {
      assert.equal(count, 0);
    });

    describe('once interval is due', ()=> {
      before(()=> {
        TimeKeeper.travel(Date.now() + 3600000);
      });

      before(Ironium.runOnce);

      it('should run the scheduled job', ()=> {
        assert.equal(count, 1);
      });

      after(TimeKeeper.reset);
    });

  });

});

