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
      return Promise.resolve();
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

  describe('twice with same handler', function() {
    it('should throw an error', function() {
      function handler() { }

      try {
        Ironium.subscribe('foo', handler);
        Ironium.subscribe('foo', handler);
        throw new Error('Should have thrown');
      } catch (error) {
        assert.equal(error.message, 'Handler already subscribed to topic foo');
      }
    });
  });

  describe('dispatch with errors', function() {
    let lastError;
    let lastSubject;
    let dispatchPromise;

    before(function() {
      Ironium.onerror(function(error, subject) {
        lastError   = error;
        lastSubject = subject;
      });

      Ironium.subscribe('with-errors', function() {
        return new Promise(function() {
          throw new Error('Handler failed');
        });
      });

      dispatchPromise = Ironium.topic('with-errors').dispatch('123', { value: randomValue });
    });

    it('should reject the promise', function() {
      return dispatchPromise
        .then(function() {
          assert(false, 'Expected promise to be rejected');
        })
        .catch(function(error) {
          assert.equal(error.message, 'Handler failed');
        });
    });

    it('should report the error', function() {
      assert.equal(lastError.message, 'Handler failed');
    });

    it('should include the topic name and message ID in the error report', function() {
      assert.equal(lastSubject, 'with-errors#123');
    });
  });
});
