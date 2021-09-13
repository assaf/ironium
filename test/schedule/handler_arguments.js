'use strict';

const assert = require('assert');
const Ironium = require('../../lib');
const ms = require('ms');
const TimeKeeper = require('timekeeper');


describe('Scheduled job handler arguments', function() {
  let lastJobPayload;
  let lastJobMetadata;

  before(function() {
    TimeKeeper.travel('2015-06-01T20:00:00Z');

    Ironium.scheduleJob('schedule-every-10m', '10m', function(payload, metadata) {
      lastJobPayload  = payload;
      lastJobMetadata = metadata;

      return Promise.resolve();
    });
  });

  before(Ironium.purgeQueues);

  describe('runOnce', function() {

    before(function() {
      TimeKeeper.travel(Date.now() + ms('10m'));
    });

    before(Ironium.runOnce);

    describe('payload', function() {
      it('should have the job time attribute', function() {
        assert(lastJobPayload.time.includes('2015-06-01T20:10'));
      });
    });

    describe('metadata', function() {
      it('should have the queue name', function() {
        const actual = lastJobMetadata.queueName;
        const expected = 'schedule-every-10m';

        assert.strictEqual(actual, expected);
      });

      it('should have the job ID', function() {
        const actual = lastJobMetadata.jobID;
        const expected = /^\d+$/;

        assert.match(actual, expected);
      });

      it('should have the receive count', function() {
        const actual = lastJobMetadata.receiveCount;
        const expected = 1;

        assert.strictEqual(actual, expected);
      });

      it('should have the receipt handle', function() {
        const actual = 'receiptHandle' in lastJobMetadata;
        const expected = true;

        assert.strictEqual(actual, expected);
      });
    });
  });
});
