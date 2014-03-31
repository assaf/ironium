/* globals before, after */
var ironium = require('../src');


// Test mode: no delay when failed jobs returned to queue.
process.env.NODE_ENV = 'test';

// Run with env DEBUG=true to see what's happening
if (process.env.DEBUG) {
  ironium.on('debug', console.log);
  ironium.on('info',  console.info);
  ironium.on('error', (error)=> console.error(error.stack));
}

before(()=> ironium.reset());
after(()=> ironium.reset());
