// Test mode: no delay when failed jobs returned to queue.
process.env.NODE_ENV = 'test';


// Job number used as prefix to isolate concurrent builds.
if (process.env.TRAVIS_JOB_NUMBER) {
  // Extract '1' from '438.1'.
  const jobIndex = process.env.TRAVIS_JOB_NUMBER.split('.').reverse()[0];
  process.env.TEST_PREFIX = `${jobIndex}-`;
}


const Bluebird  = require('bluebird');
const Ironium   = require('..');


Bluebird.config({
  warnings:        false,
  longStackTraces: true
});


before(Ironium.purgeQueues);
after(Ironium.purgeQueues);


function setup() {
  Ironium._queues._queues.clear();
  Ironium._scheduler._schedules.clear();
  Ironium.stop();
  Ironium.configure({});
  return Bluebird.delay(50);
}


module.exports = setup;
