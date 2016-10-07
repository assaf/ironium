'use strict';

const request  = require('request');
const Bluebird = require('bluebird');


const requestAsync = Bluebird.promisify(request);


module.exports = class IronMQ {
  constructor(config) {
    this.host      = config.host;
    this.projectID = config.project_id;
    this.token     = config.token;
    this.queueName = config.queue_name;
  }

  post(messages) {
    return this._request('post', '/messages', { messages });
  }

  reserve(options) {
    const n       = options.n;
    const wait    = options.wait;
    const timeout = options.timeout;

    return this._request('post', '/reservations', { timeout, wait, n })
      .then(response => response.messages)
      .catch(function(error) {
        if (error.message === 'Queue not found')
          return [];
        else
          throw error;
      });
  }

  del(message) {
    /* eslint-disable camelcase */
    const reservation_id = message.reservation_id;
    return this._request('delete', `/messages/${message.id}`, { reservation_id });
    /* eslint-enable camelcase */
  }

  release(message) {
    /* eslint-disable camelcase */
    const reservation_id = message.reservation_id;
    return this._request('post', `/messages/${message.id}/release`, { reservation_id });
    /* eslint-enable camelcase */
  }

  clear() {
    return this._request('delete', '/messages', {})
      .catch(function(error) {
        if (error.message === 'Queue not found')
          return;
        else
          throw error;
      });
  }

  _request(method, path, body) {
    const url = `https://${this.host}/3/projects/${this.projectID}/queues/${this.queueName}${path}`;
    const req = {
      url,
      method,
      body,
      json:    true,
      headers: {
        Authorization: `OAuth ${this.token}`
      }
    };
    return requestAsync(req)
      .then(res => {
        if (res.statusCode >= 400)
          throw new Error(res.body.msg);
        else
          return res.body;
      });
  }
};
