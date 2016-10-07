'use strict';

const assert  = require('assert');
const File    = require('fs');
const IronMQ  = require('../../lib/iron_mq');


const IRON_MQ = JSON.parse(File.readFileSync('iron.json'));


describe('IronMQ', function() {
  let client;

  before(function() {
    const config = Object.assign({}, IRON_MQ, { queue_name: `unexisting-${Date.now()}` }); // eslint-disable-line camelcase
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
