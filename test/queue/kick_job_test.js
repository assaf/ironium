'use strict';
require('../helpers');
const assert      = require('assert');
const Ironium     = require('../..');
const ms          = require('ms');
const TimeKeeper  = require('timekeeper');


describe('Queuing a delayed job in test enviroment', function() {

  const queue         = Ironium.queue('delayedJobQueue');
  const processedJobs = [];

  before(function() {
    queue.eachJob(function(job) {
      processedJobs.push(job);
      return Promise.resolve();
    });
  });

  describe('after a job delayed for 10 minutes is queued', function() {

    before(function() {
      return queue.delayJob('job', '10m');
    });

    describe('time traveling 5 minutes', function() {

      before(function() {
        TimeKeeper.travel(Date.now() + ms('5m'));
      });

      before(Ironium.runOnce);

      it('should not have processed job', function() {
        assert.equal(processedJobs.length, 0);
      });

      describe('time traveling 5 minutes more (10 minutes total)', function() {
        before(function() {
          TimeKeeper.travel(Date.now() + ms('5m'));
        });

        before(Ironium.runOnce);

        it('should have processed job', function() {
          assert.equal(processedJobs[0], 'job');
        });

      });

      after(TimeKeeper.reset);

    });

  });

});
