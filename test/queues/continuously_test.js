const assert = require('assert');
const fork   = require('child_process').fork;


if (typeof(describe) != 'undefined') {

  describe('Child process', function() {

    var child   = null;
    const steps = [];

    before(function(done) {
      child = fork(module.filename, { env: { NODE_ENV: 'test' } });

      child.on('message', function(step) {
        steps.push(step);
        if (process.env.DEBUG)
          console.log('Captured', step);
      });

      child.on('exit', function(code) {
        done(code ? new Error('Exited with code ' + code) : null);
      });
    });

    it('should run regular job', function() {
      assert(steps.indexOf('regular') >= 0);
    });

    it('should run three duplicate jobs', function() {
      const duplicates = steps.filter(function(step) { return step == 'duplicate'; });
      assert(duplicates.length == 3);
    });

    it('should run delayed job', function() {
      assert(steps.indexOf('delayed') >= 0);
    });

    it('should run three failed jobs', function() {
      const failed = steps.filter(function(step) { return step == 'failed'; });
      assert(failed.length == 3);
    });

    after(function() {
      child.kill();
    });

  });

} else {

  const ironium = require('../../lib');

  if (process.env.DEBUG) {
    ironium.on('debug', console.log);
    ironium.on('info',  console.info);
    ironium.on('error', console.error);
  }
  // Catch ironium.emit('error'), otherwise process fails on failed job
  ironium.on('error', function() { });


  // Regular job: queued once, execute once
  ironium.queue('regular').eachJob(function(job, callback) {
    process.send('regular');

    ironium.queue('duplicate').pushJob('job', function() {
      ironium.queue('duplicate').pushJob('job', function() {
        ironium.queue('duplicate').pushJob('job', function() {
          ironium.queue('delayed').pushJob('job', callback);
        });
      });
    });
  });

  // Duplicate job: queued and executed three times.
  ironium.queue('duplicate').eachJob(function(job, callback) {
    process.send('duplicate');
    callback();
  });

  // Delayed job: this job takes 500ms to complete.
  ironium.queue('delayed').eachJob(function(job, callback) {
    setTimeout(function() {
      process.send('delayed');

      ironium.queue('failed').pushJob('job', callback);
    }, 500);
  });

  var failed = 0;

  // Failed job: fails three times, then succeeds.
  ironium.queue('failed').eachJob(function(job, callback) {
    if (failed == 3) {
      ironium.queue('done').pushJob('job', callback);
    } else {
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
  ironium.queue('done').eachJob(function() {
    process.send('done');
    ironium.stop();
    setImmediate(function() {
      process.exit(0);
    });
  });


  // Delete all jobs from previous run before starting this one.
  // We need to have all the queues before we can call this.
  ironium.purgeQueues(function() {
    ironium.queue('regular').pushJob('job', function() {});
    ironium.start();
  });

  // Wait, otherwise process exits without processing any jobs.
  setTimeout(function() {}, 10000);

}

