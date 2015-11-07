'use strict';
const assert  = require('assert');


const BEANSTALKD_HOSTNAME = 'localhost';
const BEANSTALKD_PORT     = 11300;
const QUEUE_TEST_PREFIX   = 'test-';
const IRONIO_HOSTNAME     = 'mq-aws-us-east-1-1.iron.io';


const IRONIO_WEBHOOKURL   = 'https://{host}/3/projects/{projectID}/queues/{queueName}/webhook?oauth={token}';
const LOCAL_WEBHOOKURL    = 'https://localhost/webhooks/queues/{queueName}/messages/webhook';


module.exports = class Configuration {

  constructor(config) {
    config = config || {};

    this.prefix  = config.prefix || (process.env.NODE_ENV == 'test' ? QUEUE_TEST_PREFIX : '') || '';

    if (config.project_id || config.token) {
      // Configurating for IronMQ similar to iron.json

      assert(config.project_id, 'Configuration error: to use IronMQ, must set project_id property');
      assert(config.token,      'Configuration error: to use IronMQ, must set token property');

      this.host             = config.host || IRONIO_HOSTNAME;
      this.project_id       = config.project_id;
      this.token            = config.token;
      this._webhookURL      = IRONIO_WEBHOOKURL;

    } else if (process.env.IRON_MQ_PROJECT_ID || process.env.IRON_MQ_TOKEN) {
      // Configurating for IronMQ from environment variables (e.g. Heroku)

      assert(process.env.IRON_MQ_PROJECT_ID,  'Configuration error: to use IronMQ, must set IRON_MQ_PROJECT_ID');
      assert(process.env.IRON_MQ_TOKEN,       'Configuration error: to use IronMQ, must set IRON_MQ_TOKEN');

      this.host             = process.env.IRONIO_HOSTNAME || IRONIO_HOSTNAME;
      this.project_id       = process.env.IRON_MQ_PROJECT_ID;
      this.token            = process.env.IRON_MQ_TOKEN;
      this._webhookURL      = IRONIO_WEBHOOKURL;

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
    return this._webhookURL
        .replace('{host}',      this.host)
        .replace('{projectID}', this.project_id)
        .replace('{token}',     this.token)
        .replace('{queueName}', queueName);

  }

  get isBeanstalk() {
    const isBeanstalk = !!this.port;
    return isBeanstalk;
  }

};

