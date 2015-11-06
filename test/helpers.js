const Bluebird  = require('bluebird');
const Ironium   = require('..');


// Test mode: no delay when failed jobs returned to queue.
process.env.NODE_ENV = 'test';

Bluebird.config({
  warnings: false,
  longStackTraces: true
});


before(Ironium.purgeQueues);
after(Ironium.purgeQueues);

