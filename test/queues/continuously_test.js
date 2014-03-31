/* global describe, before, it, after */
var assert = require('assert');
var fork   = require('child_process').fork;


if (typeof(describe) != 'undefined') {

  describe('Child process', function() {

    var child;
    var steps = [];

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

    it("should run regular job", function() {
      assert(steps.indexOf('regular') >= 0);
    });

    it("should run three duplicate jobs", function() {
      var duplicates = steps.filter(function(step) { return step == 'duplicate'; });
      assert(duplicates.length == 3);
    });

    it("should run delayed job", function() {
      assert(steps.indexOf('delayed') >= 0);
    });

    it("should run three failed jobs", function() {
      var failed = steps.filter(function(step) { return step == 'failed'; });
      assert(failed.length == 3);
    });

    after(function() {
      child.kill();
    });

  });

} else {

  var ironium = require('../../lib');

  if (process.env.DEBUG) {
    ironium.on('debug', console.log);
    ironium.on('info',  console.info);
    ironium.on('error', console.error);
  }
  // Catch ironium.emit('error'), otherwise process fails on failed job
  ironium.on('error', function() { });


  // Regular job: queued once, execute once
  ironium.queue('regular').each(function(job, callback) {
    process.send('regular');

    ironium.queue('duplicate').push('job', function() {
      ironium.queue('duplicate').push('job', function() {
        ironium.queue('duplicate').push('job', function() {
          ironium.queue('delayed').push('job', callback);
        });
      });
    });
  });

  // Duplicate job: queued and executed three times.
  ironium.queue('duplicate').each(function(job, callback) {
    process.send('duplicate');
    callback();
  });

  // Delayed job: this job takes 500ms to complete.
  ironium.queue('delayed').each(function(job, callback) {
    setTimeout(function() {
      process.send('delayed');

      ironium.queue('failed').push('job', callback);
    }, 500);
  });

  var failed = 0;

  // Failed job: fails three times, then succeeds.
  ironium.queue('failed').each(function(job, callback) {
    if (failed == 3) {
      ironium.queue('done').push('job', callback);
    } else {
      process.send('failed');
      failed++;
      // Yes, we do have a callback, but by throwing an error we're testing that
      // domains work correctly.
      setImmediate(function() {
        throw new Error("Failing on purpose");
      });
    }
  });

  // Last job, exit this process successfully.
  ironium.queue('done').each(function() {
    process.send('done');
    ironium.stop();
    process.nextTick(function() {
      process.exit(0);
    });
  });


  // Delete all jobs from previous run before starting this one.
  // We need to have all the queues before we can call this.
  ironium.reset(function() {
    ironium.queue('regular').push('job', function() {});
    ironium.start();
  });

  // Wait, otherwise process exits without processing any jobs.
  setTimeout(function() {}, 10000);

}

