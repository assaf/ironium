const debug   = require('debug');
const exec    = require('child_process').exec;
const ironium = require('../src');


// Test mode: no delay when failed jobs returned to queue.
process.env.NODE_ENV = 'test';

// Run with env DEBUG=true to see what's happening
if (process.env.DEBUG) {
  ironium.on('info',  debug('ironium'));
}


// Restart beanstalkd to discard of any reserved jobs
if (process.platform === 'darwin') {
  before(function(done) {
    console.log('Restaring beanstalkd ...');
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
}

before(ironium.reset);
after(ironium.reset);
