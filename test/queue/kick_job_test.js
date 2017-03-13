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

      after(TimeKeeper.reset);

    });

    describe('time traveling 10 minutes', function() {

      before(function() {
        TimeKeeper.travel(Date.now() + ms('10m'));
      });

      before(Ironium.runOnce);

      it('should have processed job', function() {
        assert.equal(processedJobs[0], 'job');
      });

      after(TimeKeeper.reset);

    });


    after(() => processedJobs.splice(0, processedJobs.length));
  });


  describe('after multiple jobs are delayed', function() {

    before(function() {
      return queue.delayJob('job1', '2m');
    });

    before(function() {
      return queue.delayJob('job2', '3m');
    });


    describe('time traveling 1 minute', function() {

      before(function() {
        TimeKeeper.travel(Date.now() + ms('1m'));
      });

      before(Ironium.runOnce);

      it('should not process any jobs', function() {
        assert.equal(processedJobs.length, 0);
      });

      after(TimeKeeper.reset);
    });


    describe('time traveling 2 minutes', function() {

      before(function() {
        TimeKeeper.travel(Date.now() + ms('2m'));
      });

      before(Ironium.runOnce);

      it('should have processed \'job1\'', function() {
        assert.equal(processedJobs[0], 'job1');
      });

      it('should not have processed \'job2\'', function() {
        const noJob2 = processedJobs.find(job => job !== 'job2');
        assert(noJob2);
      });

      after(TimeKeeper.reset);

    });


    describe('time traveling 3 minutes', function() {

      before(function() {
        TimeKeeper.travel(Date.now() + ms('3m'));
      });

      before(Ironium.runOnce);

      it('should have processed \'job1\'', function() {
        assert.equal(processedJobs[0], 'job1');
      });

      it('should have processed \'job2\'', function() {
        assert.equal(processedJobs[1], 'job2');
      });

      after(TimeKeeper.reset);

    });

  });

});
