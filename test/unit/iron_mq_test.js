'use strict';

const assert          = require('assert');
const getIronMQConfig = require('../iron_mq_config');
const IronMQ          = require('../../lib/iron_mq');


(getIronMQConfig.isAvailable ? describe : describe.skip)('IronMQ', function() {
  let client;

  before(function() {
    const config = Object.assign(getIronMQConfig(), {
      queue_name: `unexisting-${Date.now()}` // eslint-disable-line camelcase
    });
    client       = new IronMQ(config);
  });

  describe('Reserve from unexisting queue', function() {
    it('should not throw', function() {
      return client.reserve({ wait: 0 })
        .then(function(messages) {
          assert.deepEqual(messages, []);
        });
    });
  });

  describe('Clearing an unexisting queue', function() {
    it('should not throw', function() {
      return client.clear();
    });
  });
});
