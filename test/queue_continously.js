var assert = require('assert');
var fork = require('child_process').fork;


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

      child.on('exit', function(code, signal) {
        done(code ? new Error('Exited with code ' + code) : null);
      });
    });

    it("should run regular job", function() {
      assert(steps.indexOf('regular') >= 0);
    });

    it("should run three duplicate jobs", function() {
      var duplicates = steps.filter(function(step) { return step == 'duplicate' });
      assert(duplicates.length == 3);
    });

    it("should run delayed job", function() {
      assert(steps.indexOf('delayed') >= 0);
    });

    it("should run three failed jobs", function() {
      var failed = steps.filter(function(step) { return step == 'failed' });
      assert(failed.length == 3);
    });

    after(function() {
      child.kill();
    });

  });

} else {

  var workers = require('../lib');

  if (process.env.DEBUG) {
    workers.on('debug', console.log);
    workers.on('info',  console.info);
    workers.on('error', console.error);
  }
  // Catch workers.emit('error'), otherwise process fails on failed job
  workers.on('error', function() { });


  // Regular job: queued once, execute once
  workers.queue('regular').each(function(job, callback) {
    process.send('regular');

    workers.queue('duplicate').push('job', function() {
      workers.queue('duplicate').push('job', function() {
        workers.queue('duplicate').push('job', function() {
          workers.queue('delayed').push('job', callback);
        });
      });
    });
  });

  // Duplicate job: queued and executed three times.
  workers.queue('duplicate').each(function(job, callback) {
    process.send('duplicate');
    callback();
  });

  // Delayed job: this job takes 500ms to complete.
  workers.queue('delayed').each(function(job, callback) {
    setTimeout(function() {
      process.send('delayed');

      workers.queue('failed').push('job', callback);
    }, 500);
  });

  var failed = 0;

  // Failed job: fails three times, then succeeds.
  workers.queue('failed').each(function(job, callback) {
    if (failed == 3) {
      workers.queue('done').push('job', callback);
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
  workers.queue('done').each(function(job, callback) {
    process.send('done');
    process.exit(0);
  });


  // Delete all jobs from previous run before starting this one.
  // We need to have all the queues before we can call this.
  workers.reset(function() {
    workers.start();
    workers.queue('regular').push('job', function() {});
  });

}

