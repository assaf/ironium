const Bluebird  = require('bluebird');
const debug     = require('debug');
const exec      = require('child_process').exec;
const ironium   = require('../src');


// Test mode: no delay when failed jobs returned to queue.
process.env.NODE_ENV = 'test';

// Run with env DEBUG=true to see what's happening
if (process.env.DEBUG) {
  ironium.on('info',  debug('ironium'));
}


before(ironium.reset);
after(ironium.reset);
