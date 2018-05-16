'use strict';

const assert       = require('assert');
const Bluebird     = require('bluebird');
const getAWSConfig = require('../aws_config');
const Ironium      = require('../..');
const ms           = require('ms');
const setup        = require('../helpers');


(getAWSConfig.isAvailable ? describe : describe.skip)('Scheduled jobs using SQS FIFO queues', function() {
  let runs;

  before(setup);

  before(function() {
    // FIFO queues available here.
    Ironium.configure(Object.assign({}, getAWSConfig(), { region: 'us-west-2' }));
  });

  before(function() {
    const now = Date.now();
    runs = 0;

    Ironium.scheduleJob('scheduled.fifo', new Date(now + ms('1s')), function(job) {
      const time = +new Date(job.time);
      if (time >= now)
        runs++;
      return Promise.resolve();
    });

    Ironium.start();
  });

  before(function() {
    return Bluebird.delay(ms('4s'));
  });

  it('should run', function() {
    assert.equal(runs, 1);
  });

  after(function() {
    Ironium.stop();
    Ironium.configure({});
  });
});
