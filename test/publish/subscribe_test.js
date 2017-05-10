'use strict';

const assert       = require('assert');
const Bluebird     = require('bluebird');
const Crypto       = require('crypto');
const Ironium      = require('../..');
const ms           = require('ms');
const setup        = require('../helpers');


describe('Subscribe', function() {
  const randomValue = Crypto.randomBytes(32).toString('hex');
  let lastMessage;

  before(setup);

  before(function() {
    Ironium.subscribe('foo', function(message) {
      lastMessage = message;
    });
  });

  before(function() {
    return Ironium.publish('foo', { value: randomValue });
  });

  before(function() {
    return Bluebird.delay(ms('1s'));
  });

  it('should have sent the message to the subscribed handler', function() {
    assert.equal(lastMessage.value, randomValue);
  });
});
