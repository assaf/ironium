'use strict';

const assert   = require('assert');
const Bluebird = require('bluebird');
const Crypto   = require('crypto');
const Ironium  = require('../..');
const setup    = require('../helpers');


describe('Unsubscribe', function() {
  const randomValue = Crypto.randomBytes(32).toString('hex');
  const messages    = [];
  let subscription;

  before(setup);

  before(function() {
    subscription = Ironium.subscribe('foo', function(message) {
      messages.push(message);
      return Promise.resolve();
    });
  });

  before(function() {
    // Ensure subscription is working correctly in this test.
    return Ironium.publish('foo', { value: randomValue })
      .then(() => Bluebird.delay(10))
      .then(() => assert.equal(messages.length, 1));
  });

  before(function() {
    subscription.unsubscribe();
  });

  before(function() {
    return Ironium.publish('foo', { value: randomValue })
      .then(() => Bluebird.delay(10));
  });

  it('should not dispatch to handler', function() {
    assert.equal(messages.length, 1);
  });

  describe('twice', function() {
    it('should throw an error', function() {
      try {
        subscription.unsubscribe();
        throw new Error('Should have thrown');
      } catch (error) {
        assert.equal(error.message, 'Already unsubscribed');
      }
    });
  });
});
