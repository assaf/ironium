'use strict';

const assert = require('assert');
const Crypto = require('crypto');
const runJob = require('./run_job');
const SNS    = require('./sns');


// Abstraction for a topic.
class Topic {

  constructor(server, topicName) {
    this._server     = server;
    this.name        = topicName;
    this.subscribers = new Set();
  }


  // Publish to a topic.
  publish(message) {
    const stringMessage = JSON.stringify(message);

    if (process.env.NODE_ENV === 'test') {
      // JSON encode/decode the message before passing to
      // subscriber, same transformation as when using SNS.
      const parsedMessage = JSON.parse(stringMessage);
      const messageID     = Crypto.randomBytes(32).toString('hex');
      setImmediate(() => {
        this.dispatch(messageID, parsedMessage);
      });
      return Promise.resolve();
    } else {
      return this.clientPromise
        .then(client => client.publish(this.name, stringMessage));
    }
  }


  // Subscribe to a topic by registering a handler function.
  //
  // Returns a subscription object which can be used to unsubscribe:
  //
  //   const subscription = Ironium.subscribe('topic', function(message) {
  //     // ...
  //     subscription.unsubscribe();
  //   });
  //
  subscribe(handler) {
    if (process.env.NODE_ENV !== 'test')
      throw new Error('Subscribe only available in test mode');

    if (this.subscribers.has(handler))
      throw new Error(`Handler already subscribed to topic ${this.name}`);

    this.subscribers.add(handler);

    return {
      unsubscribe: () => {
        if (this.subscribers.has(handler))
          this.subscribers.delete(handler);
        else
          throw new Error('Already unsubscribed');
      }
    };
  }


  // Dispatches a message to all subscribers.
  // Returns a promise that resolves when all subscribers resolve.
  dispatch(messageID, payload) {
    const handlers = Array.from(this.subscribers);
    const promises = handlers.map(handler => {
      return runJob(messageID, handler, [ payload ])
        .catch(error => {
          this._server._ironium.reportError(`${this.name}#${messageID}`, error);
          throw error;
        });
    });
    return Promise.all(promises);
  }


  // -- Client --

  get clientPromise() {
    if (!this._clientPromise)
      this._clientPromise = this._server.configPromise.then(config => this._clientFromConfig(config));
    return this._clientPromise;
  }

  _clientFromConfig(config) {
    switch (config.service) {
      case 'aws': {
        const awsConfig = {
          accessKeyId:     config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          credentials:     config.credentials,
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
