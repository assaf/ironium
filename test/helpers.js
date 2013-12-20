const workers = require('../src');


// Test mode: no delay when failed jobs returned to queue.
process.env.NODE_ENV = 'test';

// Run with env DEBUG=true to see what's happening
if (process.env.DEBUG) {
  workers.on('debug', (message)=> console.log(message))
  workers.on('info',  (message)=> console.info(message))
  workers.on('error', (error)=> console.error(error.stack))
}

