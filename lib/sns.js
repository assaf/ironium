'use strict';

const assert = require('assert');
const AWS    = require('aws-sdk');


module.exports = class SNS {
  constructor(config) {
    this.accessKeyId     = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.credentials     = config.credentials;
    this.region          = config.region;
    this.topicName       = config.topicName;
    this.topicARN        = null;
  }

  publish(topic, message) {
    return this.snsClient()
      .then(snsClient => {
        const snsParams = {
          TopicArn: this.topicARN,
          Message:  message
        };

        return snsClient.publish(snsParams).promise();
      })
      .then(response => response.MessageId);
  }


  snsClient() {
    if (this._snsClient)
      return this._snsClient;
    else {
      const clientObject = new AWS.SNS({
        accessKeyId:     this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        credentials:     this.credentials,
        region:          this.region
      });

      // Topics are immutable and don't have any specific configuration.
      // CreateTopic can be used to look up a topic's ARN by name:
      //
      //   > This action is idempotent, so if the requester already owns a topic
      //   > with the specified name, that topic's ARN is returned without
      //   > creating a new topic.
      //
      //   http://docs.aws.amazon.com/sns/latest/api/API_CreateTopic.html
      //
      this._snsClient = clientObject.createTopic({ Name: this.topicName }).promise()
        .then(response => {
          const topicARN = response.TopicArn;
          assert(topicARN, `Topic ARN not found for ${this.topicName}`);
          this.topicARN = topicARN;
          return clientObject;
        });

      return this._snsClient;
    }
  }
};
