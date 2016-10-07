'use strict';

const assert    = require('assert');
const Beanstalk = require('../../lib/beanstalk');


describe('Beanstalk', function() {
  let client;

  before(function() {
    client = new Beanstalk({ host: '127.0.0.1', port: 11300 }, 'id', function() { });
  });

  describe('Reserve with timeout', function() {
    it('should not throw', function() {
      return client.reserve({ wait: 1 })
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
