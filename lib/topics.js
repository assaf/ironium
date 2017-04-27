'use strict';

const assert = require('assert');
const SNS    = require('./sns');


// Abstraction for a topic.
class Topic {

  constructor(server, topicName) {
    this._server = server;
    this.name    = topicName;
  }


  // Publish to a topic.
  publish(message) {
    return this.clientPromise
      .then(client => {
        const stringMessage = JSON.stringify(message);
        return client.publish(this.name, stringMessage);
      });
  }


  // -- Clients --

  get clientPromise() {
    if (!this._clientPromise)
      this._clientPromise = this._server.configPromise.then(client => this._clientFromConfig(client));
    return this._clientPromise;
  }

  _clientFromConfig(config) {
    switch (config.service) {
      case 'aws': {
        const awsConfig = {
          accessKeyId:     config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          region:          config.region,
          topicName:       config.prefixedName(this.name)
        };
        return new SNS(awsConfig);
      }

      default:
        throw new Error('Pub/sub only supported in AWS.');
    }
  }

}


// Abstracts the topic server.
module.exports = class Topics {

  constructor(ironium) {
    this._ironium = ironium;
    this._topics  = new Map();
  }

  // Returns the named queue, queue created on demand.
  getTopic(topicName) {
    assert(topicName, 'Missing topic name');

    if (!this._topics.has(topicName)) {
      const topic = new Topic(this, topicName);

      if (this.started)
        topic.start();

      this._topics.set(topicName, topic);
    }

    return this._topics.get(topicName);
  }

  // Returns an array of all topics.
  get topics() {
    return Array.from(this._topics.values());
  }

  // Resolves to Configuration object.
  get configPromise() {
    // Lazy load configuration.
    return this._ironium.configPromise;
  }

};
