const exec    = require('child_process').exec;
const ironium = require('../src');


// Test mode: no delay when failed jobs returned to queue.
process.env.NODE_ENV = 'test';

// Run with env DEBUG=true to see what's happening
if (process.env.DEBUG) {
  ironium.on('debug', console.log);
  ironium.on('info',  console.info);
  ironium.on('error', (error)=> console.error(error.stack));
}


// Restart beanstalkd to discard of any reserved jobs
before(function(done) {
  exec('launchctl stop homebrew.mxcl.beanstalk', function(error, stdout) {
    process.stdout.write(stdout);
    exec('launchctl start homebrew.mxcl.beanstalk', function(error, stdout) {
      process.stdout.write(stdout);

      setTimeout(function() {
        done(error);
      }, 1000);
    });
  });
});

before(ironium.reset);
after(ironium.reset);
