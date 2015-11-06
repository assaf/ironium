const Bluebird  = require('bluebird');
const debug     = require('debug');
const Ironium   = require('..');


// Test mode: no delay when failed jobs returned to queue.
process.env.NODE_ENV = 'test';


before(Ironium.purgeQueues);
after(Ironium.purgeQueues);

Bluebird.config({
  warnings: false,
  longStackTraces: true
});

