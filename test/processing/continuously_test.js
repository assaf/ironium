'use strict';
const assert = require('assert');
const fork   = require('child_process').fork;


const isMocha = !!global.describe;

if (isMocha)
	runTestSuite();
else
	runChildProcess();


function runTestSuite() {

  describe('Child process', function() {

    var child   = null;
    const steps = [];

    before(function(done) {
      child = fork(module.filename, { env: { NODE_ENV: 'test', DEBUG: process.env.DEBUG } });

      child.on('message', function(step) {
        steps.push(step);
      });

      child.on('exit', function(code) {
        done(code ? new Error('Exited with code ' + code) : null);
      });
    });

    it('should run regular job', function() {
      assert(steps.indexOf('regular') >= 0);
    });

    it('should run three duplicate jobs', function() {
      const duplicates = steps.filter(function(step) { return step === 'duplicate'; });
      assert.equal(duplicates.length, 3);
    });

    it('should run delayed job', function() {
      assert(steps.indexOf('delayed') >= 0);
    });

    it('should run three failed jobs', function() {
      const failed = steps.filter(function(step) { return step == 'failed'; });
      assert.equal(failed.length, 3);
    });

    after(function() {
      child.kill();
    });

  });
}


function runChildProcess() {

  const Ironium = require('../..');

  // Catch Ironium.emit('error'), otherwise process fails on failed job
  Ironium.on('error', function() { });


  // Regular job: queued once, execute once
  Ironium.queue('regular').eachJob(function(job, callback) {
    process.send('regular');

    Ironium.queueJob('duplicate', 'job', function() {
      Ironium.queueJob('duplicate', 'job', function() {
        Ironium.queueJob('duplicate', 'job', function() {
          Ironium.queueJob('delayed', 'job', callback);
        });
      });
    });
  });

  // Duplicate job: queued and executed three times.
  Ironium.queue('duplicate').eachJob(function(job, callback) {
    process.send('duplicate');
    callback();
  });

  // Delayed job: this job takes 500ms to complete.
  Ironium.queue('delayed').eachJob(function(job, callback) {
    setTimeout(function() {
      process.send('delayed');
      Ironium.queueJob('failed', 'job', callback);
    }, 500);
  });

  var failed = 0;

  // Failed job: fails three times, then succeeds.
  Ironium.queue('failed').eachJob(function(job, callback) {
    if (failed === 3)
      Ironium.queueJob('done', 'job', callback);
    else {
      process.send('failed');
      failed++;
      // Yes, we do have a callback, but by throwing an error we're testing that
      // domains work correctly.
      setImmediate(function() {
        throw new Error('Failing on purpose');
      });
    }
  });

  // Last job, exit this process successfully.
  Ironium.queue('done').eachJob(function() {
		process.send('done');
		Ironium.stop();
		setTimeout(function() {
			process.exit(0);
		}, 100);
  });


  // Delete all jobs from previous run before starting this one.
  // We need to have all the queues before we can call this.
  Ironium.purgeQueues(function() {
    Ironium.queueJob('regular', 'job', function() {});
    Ironium.start();
  });

  // Wait, otherwise process exits without processing any jobs.
  setTimeout(function() {}, 10000);

}

