const Bluebird  = require('bluebird');
const debug     = require('debug');
const Ironium   = require('..');


// Test mode: no delay when failed jobs returned to queue.
process.env.NODE_ENV = 'test';

// Run with env DEBUG=true to see what's happening
if (process.env.DEBUG)
  Ironium.on('info', debug('ironium'));

/*
Ironium.configure({
	project_id: "563b895873d0cd0005000058",
	token:      "uCJUkl8X8XuHKLTB5VwVVf_0-Ng",
	host:       "mq-aws-eu-west-1-1.iron.io"
});
*/


before(Ironium.purgeQueues);
after(Ironium.purgeQueues);

Bluebird.config({
  warnings: false,
  longStackTraces: true
});

