/* globals before, after */
const ironium = require('../src');


// Test mode: no delay when failed jobs returned to queue.
process.env.NODE_ENV = 'test';

// Run with env DEBUG=true to see what's happening
if (process.env.DEBUG) {
  ironium.on('debug', (message)=> console.log(message));
  ironium.on('info',  (message)=> console.info(message));
  ironium.on('error', (error)=> console.error(error.stack));
}

before(()=> ironium.reset());
after(()=> ironium.reset());
