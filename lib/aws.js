'use strict';

const assert  = require('assert');
const SQS     = require('aws-sdk').SQS;


module.exports = class AWS {
  constructor(config) {
    this.accessKeyId     = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.region          = config.region;
    this.queueName       = config.queueName;
  }

  post(messages) {
    return this.sqsClient()
      .then(sqsClient => {
        const entries = messages.map(function(message, index) {
          return {
            // Result may be unordered, that's why we need to provide an ID
            // for each message in this batch.
            Id:          index.toString(),
            MessageBody: message.body
          };
        });

        const sqsPayload = {
          QueueUrl: this.queueURL,
          Entries:  entries
        };

        return sqsClient.sendMessageBatch(sqsPayload).promise();
      })
      .then(response => {
        const successful = response.Successful;
        const failed     = response.Failed;

        if (failed.length)
          throw new Error(`Error queueing ${failed.length} jobs to ${this.queueName}`);

        // Reconstruct array of job IDs based on the batch ID for this request.
        const orderedJobIDs = messages.map(function(message, index) {
          const responseResult = successful.find(msg => msg.Id === index.toString());
          assert(responseResult);
          return responseResult.MessageId;
        });

        return orderedJobIDs;
      });
  }

  reserve(options) {
    const n       = options.n;
    const timeout = options.timeout;
    const wait    = options.wait;

    return this.sqsClient()
      .then(sqsClient => {
        // SQS allows up to 10 messages per request.
        const maxNumberOfMessages  = Math.min(n, 10);
        // SQS allows long-polling up to 20 seconds.
        const waitTimeSeconds      = Math.min(wait, 20);
        const receiveMessageParams = {
          QueueUrl:            this.queueURL,
          MaxNumberOfMessages: maxNumberOfMessages,
          VisibilityTimeout:   timeout,
          WaitTimeSeconds:     waitTimeSeconds
        };
        return sqsClient.receiveMessage(receiveMessageParams).promise();
      })
      .then(response => {
        const messages = response.Messages.map(function(msg) {
          return {
            id:            msg.MessageId,
            body:          msg.Body,
            // ReceiptHandle is what we use to delete or increase visibility
            // timeout for a message.
            receiptHandle: msg.ReceiptHandle
          };
        });
        return messages;
      });
  }

  del(message) {
    return this.sqsClient()
      .then(sqsClient => {
        const deleteParams = {
          QueueUrl:      this.queueURL,
          ReceiptHandle: message.receiptHandle
        };
        return sqsClient.deleteMessage(deleteParams).promise();
      });
  }

  release(message, options) {
    return this.sqsClient()
      .then(sqsClient => {
        const changeVisibilityParams = {
          QueueUrl:          this.queueURL,
          ReceiptHandle:     message.receiptHandle,
          VisibilityTimeout: options.delay
        };
        return sqsClient.changeMessageVisibility(changeVisibilityParams).promise();
      });
  }

  clear() {
    return this.sqsClient()
      .then(sqsClient => sqsClient.purgeQueue({ QueueUrl: this.queueURL }).promise());
  }

  sqsClient() {
    if (this._sqsClient)
      return this._sqsClient;
    else {
      const clientObject = new SQS({
        accessKeyId:     this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
        region:          this.region
      });

      this._sqsClient = clientObject.getQueueUrl({ QueueName: this.queueName }).promise()
        .then(response => {
          const queueURL = response.QueueUrl;
          assert(queueURL, `Queue URL not found for ${this.queueName}`);
          this.queueURL = queueURL;
          return clientObject;
        });

      return this._sqsClient;
    }
  }
};
