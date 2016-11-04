'use strict';

const request  = require('request');
const Bluebird = require('bluebird');


module.exports = class IronMQ {
  constructor(config) {
    this.host      = config.host;
    this.projectID = config.project_id;
    this.token     = config.token;
    this.queueName = config.queue_name;
  }

  post(messages) {
    return this._request('post', '/messages', { messages })
      .then(response => response.ids);
  }

  reserve(options) {
    const n       = options.n;
    const wait    = options.wait;
    const timeout = options.timeout;

    return this._request('post', '/reservations', { timeout, wait, n })
      .then(response => response.messages)
      .catch(function(error) {
        // IronMQ treats an unexisting queue as an error.
        // Expose as empty queue instead.
        if (error.code === 404) {
          return Bluebird.delay(wait * 1000)
            .then(() => []);
        } else
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
        if (error.code === 404)
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
    return Bluebird.promisify(request)(req)
      .then(function(res) {
        if (res.statusCode >= 400) {
          const message = (res.body && res.body.msg) ? res.body.msg : null;
          const error   = new Error(`IronMQ returned ${res.statusCode} ${message}`);
          error.code    = res.statusCode;
          throw error;
        } else
          return res.body;
      });
  }
};
