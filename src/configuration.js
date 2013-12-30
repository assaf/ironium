const { format } = require('util');


const BEANSTALKD_HOSTNAME = 'localhost';
const BEANSTALKD_PORT     = 11300;
const QUEUE_TEST_PREFIX   = 'test-';
const IRONIO_HOSTNAME     = 'mq-aws-us-east-1.iron.io';

const IRONIO_WEBHOOKURL   = 'https://%s/1/projects/%s/queues/{queueName}/messages/webhook?oauth=%s';
const IRONIO_AUTHENTICATE = 'oauth %s %s';
const LOCAL_WEBHOOKURL    = 'https://localhost/webhooks/queues/{queueName}/messages/webhook';


module.exports = class Configuration {

  constructor(source = {}) {

    // Configuration specific to queues.
    this.queues = {};
    if (source.queues) {
      if (source.queues.prefix)
        this.queues.prefix  = source.queues.prefix + '';
      this.queues.width     = source.queues.width || 1;
      this.queues.hostname  = source.queues.hostname;
      this.queues.port      = source.queues.port;
    }
    // Apply defaults.
    if (!this.queues.hasOwnProperty('prefix'))
      this.queues.prefix = (process.env.NODE_ENV == 'test' ? QUEUE_TEST_PREFIX : '');
    this.queues.width     = this.queues.width || 1;
    this.queues.hostname  = this.queues.hostname || BEANSTALKD_HOSTNAME;
    this.queues.port      = this.queues.port     || BEANSTALKD_PORT;

    // Configuration specific to scheduler.
    this.scheduler = {};

    // Configurating for Iron.io.
    if (source.ironio) {
      if (source.ironio.token && source.ironio.projectID) {
        var hostname      = source.ironio.hostname || IRONIO_HOSTNAME;
        this.authenticate = format(IRONIO_AUTHENTICATE, source.ironio.token, source.ironio.projectID);
        this._webhookURL  = format(IRONIO_WEBHOOKURL, hostname, source.ironio.projectID, source.ironio.token);
        // When using Iron.io, force hostname/port configuration.
        this.queues.hostname = hostname;
        this.queues.port     = BEANSTALKD_PORT;
      } else if (source.ironio.token || source.ironio.projectID)
        throw new Error("Configuration error: to use Iron.io, must set both ironio.projectID and ironio.token");
    }
    this._webhookURL  = this._webhookURL || LOCAL_WEBHOOKURL;
  }

  // -- Queues --

  // queues.hostname and queues.port, but use hostname if there (Iron.io)
  //

  prefixedName(name) {
    return this.queues.prefix + name;
  }

  webhookURL(queueName) {
    return this._webhookURL.replace('{queueName}', queueName);
  }

}

