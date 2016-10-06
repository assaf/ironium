'use strict';
const assert  = require('assert');
const fork    = require('child_process').fork;
const Ironium = require('../..');


const isMocha = !!global.describe;

if (isMocha)
  runTestSuite();
else
  runChildProcess();


function runTestSuite() {

  describe('Child process', function() {

    let child;
    const steps = [];

    before(function() {
      Ironium.configure({ concurrency: 1 });
    });

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

  const Bluebird  = require('bluebird');
  const Ironium   = require('../..');


  // Regular job: queued once, execute once
  Ironium.eachJob('regular', function() {
    process.send('regular');

    return Ironium.queueJob('duplicate', 'job')
      .then(function() {
        return Ironium.queueJob('duplicate', 'job');
      })
      .then(function() {
        return Ironium.queueJob('duplicate', 'job');
      })
      .then(function() {
        return Ironium.queueJob('delayed', 'job');
      });
  });

  // Duplicate job: queued and executed three times.
  Ironium.queue('duplicate').eachJob(function(job) {
    process.send('duplicate');
    return Promise.resolve();
  });

  // Delayed job: this job takes 500ms to complete.
  Ironium.queue('delayed').eachJob(function() {
    return Bluebird.delay(500)
      .then(function() {
        process.send('delayed');
        return Ironium.queueJob('failed', 'job');
      });
  });

  let failed = 0;

  // Failed job: fails three times, then succeeds.
  Ironium.queue('failed').eachJob(function() {
    if (failed === 3)
      return Ironium.queueJob('done', 'job');
    else {
      process.send('failed');
      failed++;
      // By throwing an error (as opposed to rejecting
      // the promise) we're testing that domains work
      // correctly.
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
  Ironium.purgeQueues()
    .then(Ironium.start)
    .then(function() {
      return Ironium.queueJob('regular', 'job');
    });

  // Wait, otherwise process exits without processing any jobs.
  setTimeout(function() {}, 10000);

}

