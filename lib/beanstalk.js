// Represents a Beanstalkd session that works similar to an IronMQ client.
//
// Since GET requests block, need separate sessions for pushing and processing,
// and each is also setup differently.
//
// Underneath there is a Fivebeans client that gets connected and automatically
// reconnected after failure (plus some error handling missing from Fivebeans).
//
// To use the underlying client, call the method `request`.

'use strict';
const Fivebeans  = require('fivebeans');
const ms         = require('ms');


// How long to wait establishing a new connection.
const CONNECT_TIMEOUT       = ms('5s');


// Error talking to queue server, typically transient
class QueueError extends Error {

  constructor(error) {
    super();
    this.message = error.message || error;
    this.name    = error.name    || this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

}


module.exports = class Beanstalk {

  // Construct a new session.
  //
  // id      - Session id, used for error reporting
  // config  - Queue server configuration, used to establish connection
  // notify  - Logging and errors
  // setup   - The setup function, see below
  //
  // Beanstalkd requires setup to either use or watch a tube, depending on the
  // session.  The setup function is provided when creating the session, and is
  // called after the connection has been established (and for Iron.io,
  // authenticated).
  //
  // The setup function is called with two arguments:
  // client   - Fivebeans client being setup
  // callback - Call with error or nothing
  constructor(server, id, setup) {
    this.id       = id;
    this.setup    = setup;
    this._config  = server.config;
    this._notify  = server.notify;

    this._connectPromise = null;
  }


  // Make a request to the server.
  //
  // command  - The command (e.g. put, get, destroy)
  // args     - Zero or more arguments, depends on command
  //
  // Returns a promise that resolves to single value, or array, depending on
  // command.
  //
  // This is a simple wrapper around the Fivebeans client with additional error
  // handling.
  request(command /*, ...args */) {
		const args = Array.from(arguments).slice(1);

    // Ask for connection, we get a promise that resolves into a client.
    // We return a new promise that resolves to the output of the request.
		return this.connect()
			.then((client)=> {

				return new Promise((resolve, reject)=> {
					// Processing (continuously or not) know to ignore the TIMED_OUT
					// and CLOSED errors.

					// When Fivebeans client executes a command, it doesn't monitor for
					// connection close/error, so we need to catch these events ourselves
					// and reject the promise.
					const onConnectionEnded = (error)=> {
						reject(new QueueError(error || 'CLOSED'));
						this._notify.debug('%s: %s => %s', this.id, command, error || 'CLOSED');
					};

					client.once('close', onConnectionEnded);
					client.once('error', onConnectionEnded);

					const session = this;
					this._notify.debug('%s: $ %s %j', this.id, command, args);

					function callback(error) {
						const results = Array.from(arguments).slice(1);

						// This may never get called
						client.removeListener('close', onConnectionEnded);
						client.removeListener('error', onConnectionEnded);

						if (error) {
							session._notify.debug('%s: %s => %s', session.id, command, error);
							reject(new QueueError(error));
						} else if (results.length > 1) {
							session._notify.debug('%s: %s => %j', session.id, command, results);
							resolve(results);
						} else {
							session._notify.debug('%s: %s => %j', session.id, command, results[0]);
							resolve(results[0]);
						}
					}
					client[command].apply(client, args.concat(callback));
				});

			});
  }


  // Called to establish a new connection, or use existing connections.
  // Resolves to a FiveBeans client.
  connect() {
    // This may be called multiple times, we only want to establish the
    // connection once, so we reuse the same promise
    if (this._connectPromise)
			return this._connectPromise;

		let connectPromise;

		const onClose = ()=> {
			// If client connection closed/end, discard the promise
			if (this._connectPromise === connectPromise)
				this._connectPromise = null;
		};

    connectPromise = this._connect(onClose)
			.catch((error)=> {
				onClose();
				throw new QueueError(error);
			});
    this._connectPromise = connectPromise;
		return connectPromise;
  }


  _connect(onClosed) {
		return Promise.resolve()
			.then(()=> {

				// This is the Fivebeans client is essentially a session.
				const config  = this._config;
				const client  = new Fivebeans.client(config.host, config.port);
				// For when we have a lot of writers contending to push to the same queue.
				client.setMaxListeners(0);

				// Once we established a connection, need to monitor for errors of when
				// server decides to close it
				client.once('error', (error)=> {
					onClosed();
					this._notify.debug('Client error in queue %s: %s', this.id, error.toString());
				});

				// This promise resolves when client connects.
				const establishConnection = new Promise(function(resolve, reject) {
					// Nothing happens until we start the connection.  Must wait for
					// connection event before we can send anything down the stream.
					client.connect();

					client.on('connect', ()=> resolve());
					client.on('error', reject);
					client.on('close', function() {
						reject(new QueueError('CLOSED'));
					});

					// Make sure we timeout on slow connections
					setTimeout(function() {
						reject(new Error('Timeout waiting for connection'));
					}, CONNECT_TIMEOUT);
				});

				return establishConnection
					.then(()=> {

						// Watch for end and switch to new session
						client.stream.once('end', ()=> {
							onClosed();
							this._notify.debug('Connection closed for %s', this.id);
						});

						// Put/reserve clients have different setup requirements, this are handled by
						// an externally supplied method.
						return this.setup(client);
					})
					.then(()=> client);

			});
  }


  // Close this session
  end() {
    if (this._connectPromise) {
      this._connectPromise
        .then(client => client.end())
        .catch(()=> null);
      this._connectPromise = null;
    }
  }


	del(message_id, options, callback) {
		return this.request('destroy', message_id)
			.then(()=> callback(), callback);
	}

	msg_release(message_id, reservation_id, options, callback) {
		const priority = 0;
    return this.request('release', message_id, priority, options.delay)
			.then(()=> callback(), callback);
	}

	peek(options, callback) {
		const peekReady 	= this.request('peek_ready').then((result)=> result[0]).catch(()=> null);
		const peekDelayed = this.request('peek_delayed').then((result)=> result[0]).catch(()=> null);
		return Promise.all([ peekReady, peekDelayed ])
			.then(function(ids) {
				const notNull = ids.filter(id => id);
				callback(null, notNull);
			})
			.catch(callback);
	}

	post(params, callback) {
		const priority = 0;
		return this.request('put', priority, params.delay, params.timeout, params.body)
			.then((id)=> callback(null, id), callback);
	}

	reserve(options, callback) {
		return this.request('reserve_with_timeout', options.timeout)
			.then(function(job) {
				const id        			= job[0];
				const body       			= job[1];
				const reservation_id 	= id;
				const reserved_count 	= 1;

				const message 				= { id, body, reserved_count, reservation_id };
				callback(null, message);
			})
			.catch(function(error) {
				if (error.message === 'TIMED_OUT')
					callback(null, null);
				else
					callback(error);
			});
	}

};

