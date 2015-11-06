'use strict';
const assert  = require('assert');
const Util    = require('util');


const BEANSTALKD_HOSTNAME = 'localhost';
const BEANSTALKD_PORT     = 11300;
const QUEUE_TEST_PREFIX   = 'test-';
const IRONIO_HOSTNAME     = 'mq-aws-us-east-1.iron.io';

const IRONIO_WEBHOOKURL   = 'https://%s/1/projects/%s/queues/{queueName}/messages/webhook?oauth=%s';
const IRONIO_AUTHENTICATE = 'oauth %s %s';
const LOCAL_WEBHOOKURL    = 'https://localhost/webhooks/queues/{queueName}/messages/webhook';


module.exports = class Configuration {

  constructor(config) {
		config = config || {};

    this.prefix  = config.prefix || (process.env.NODE_ENV == 'test' ? QUEUE_TEST_PREFIX : '') || '';
    this.width   = config.width || 1;

    if (config.project_id || config.token) {
      // Configurating for IronMQ similar to iron.json

      assert(config.host,       'Configuration error: to use IronMQ, must set host property');
      assert(config.project_id, 'Configuration error: to use IronMQ, must set project_id property');
      assert(config.token,      'Configuration error: to use IronMQ, must set token property');

      this.host             = config.host;
      this._webhookURL      = Util.format(IRONIO_WEBHOOKURL, config.host, config.project_id, config.token);

    } else if (process.env.IRON_MQ_PROJECT_ID || process.env.IRON_MQ_TOKEN) {
      // Configurating for IronMQ from environment variables (e.g. Heroku)

      assert(process.env.IRONIO_HOSTNAME,     'Configuration error: to use IronMQ, must set IRONIO_HOSTNAME');
      assert(process.env.IRON_MQ_PROJECT_ID,  'Configuration error: to use IronMQ, must set IRON_MQ_PROJECT_ID');
      assert(process.env.IRON_MQ_TOKEN,       'Configuration error: to use IronMQ, must set IRON_MQ_TOKEN');

      this.host             = IRONIO_HOSTNAME;
      this._webhookURL      = Util.format(IRONIO_WEBHOOKURL, IRONIO_HOSTNAME, process.env.IRON_MQ_PROJECT_ID, process.env.IRON_MQ_TOKEN);

    } else {
      // Beanstalkd
      this.host             = config.host || BEANSTALKD_HOSTNAME;
      this.port             = config.port || BEANSTALKD_PORT;
      this._webhookURL      = LOCAL_WEBHOOKURL;
    }
  }

  // -- Queues --

  // queues.hostname and queues.port, but use hostname if there (IronMQ)
  //

  prefixedName(name) {
    return this.prefix + name;
  }

  webhookURL(queueName) {
    return this._webhookURL.replace('{queueName}', queueName);
  }

};

