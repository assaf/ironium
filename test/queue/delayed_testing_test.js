'use strict';

const assert      = require('assert');
const Ironium     = require('../..');
const ms          = require('ms');
const TimeKeeper  = require('timekeeper');
const setup       = require('../helpers');


describe('Queuing a delayed job in test environment', function() {

  const queue         = Ironium.queue('delayedJobQueue');
  const processedJobs = [];

  before(setup);

  before(function() {
    queue.eachJob(function(job) {
      processedJobs.push(job);
      return Promise.resolve();
    });
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
