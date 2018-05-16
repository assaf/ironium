'use strict';

const assert       = require('assert');
const Bluebird     = require('bluebird');
const Crypto       = require('crypto');
const getAWSConfig = require('../aws_config');
const Ironium      = require('../..');
const ms           = require('ms');
const setup        = require('../helpers');


(getAWSConfig.isAvailable ? describe : describe.skip)('Publish - AWS', function() {
  // We test that publish works by consuming from this queue
  // (which must be subscribed to the topic).
  let snsSubscribedQueue;
  const processedJobs   = [];
  const randomValue     = Crypto.randomBytes(32).toString('hex');

  function processJob(notification) {
    const job = JSON.parse(notification.Message);
    processedJobs.push(job);
    return Promise.resolve();
  }

  before(setup);

  before(function() {
    snsSubscribedQueue = Ironium.queue('sns-foo-notification');
  });

  before(function() {
    Ironium.configure(getAWSConfig());
    process.env.NODE_ENV = 'production';
  });

  before(function() {
    snsSubscribedQueue.eachJob(processJob);
  });

  before(function() {
    return Ironium.publish('foo-notification', { value: randomValue });
  });

  before(function() {
    Ironium.start();
  });

  before(function() {
    return Bluebird.delay(ms('3s'));
  });

  it('should have published to SNS and processed the job in SQS', function() {
    const processedJob = processedJobs.find(job => job.value === randomValue);
    assert(processedJob);
  });

  after(function() {
    process.env.NODE_ENV = 'test';
    Ironium.stop();
    Ironium.configure({});
  });
});
