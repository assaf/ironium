'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');


describe('Webhook URL', function() {

  const config = {
    host:       'mq-aws-us-east-1-1.iron.io',
    project_id: '5687', // eslint-disable-line camelcase
    token:      'abcdef'
  };
  const instance = new (Ironium.constructor)(config);

  it('should include project ID, token and queue name', function() {
    return instance.webhookURL('hookery').then(function(actual) {
      const expected = 'https://mq-aws-us-east-1-1.iron.io/3/projects/5687/queues/hookery/webhook?oauth=abcdef';
      assert.equal(actual, expected);
    });
  });

});

