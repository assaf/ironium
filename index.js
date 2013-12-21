var $__getProtoParent = function(superClass) {
  if (typeof superClass === 'function') {
    var prototype = superClass.prototype;
    if (Object(prototype) === prototype || prototype === null) return superClass.prototype;
  }
  if (superClass === null) return null;
  throw new TypeError();
}, $__Object = Object, $__getOwnPropertyNames = $__Object.getOwnPropertyNames, $__getOwnPropertyDescriptor = $__Object.getOwnPropertyDescriptor, $__getDescriptors = function(object) {
  var descriptors = {}, name, names = $__getOwnPropertyNames(object);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    descriptors[name] = $__getOwnPropertyDescriptor(object, name);
  }
  return descriptors;
}, $__createClass = function(object, staticObject, protoParent, superClass, hasConstructor) {
  var ctor = object.constructor;
  if (typeof superClass === 'function') ctor.__proto__ = superClass;
  if (!hasConstructor && protoParent === null) ctor = object.constructor = function() {};
  var descriptors = $__getDescriptors(object);
  descriptors.constructor.enumerable = false;
  ctor.prototype = Object.create(protoParent, descriptors);
  Object.defineProperties(ctor, $__getDescriptors(staticObject));
  return ctor;
}, $__TypeError = TypeError, $__toObject = function(value) {
  if (value == null) throw $__TypeError();
  return $__Object(value);
}, $__spread = function() {
  var rv = [], k = 0;
  for (var i = 0; i < arguments.length; i++) {
    var value = $__toObject(arguments[i]);
    for (var j = 0; j < value.length; j++) {
      rv[k++] = value[j];
    }
  }
  return rv;
};
var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var format = require('util').format;
var Queues = require('./queues');
var Scheduler = require('./scheduler');
var runner = require('./runner');
function returnPromiseOrCallback(promise, callback) {
  if (callback) promise.then(function() {
    setImmediate(callback);
  }, function(error) {
    callback(error);
  }); else return promise;
}
var Workers = function($__super) {
  'use strict';
  var $__proto = $__getProtoParent($__super);
  var $Workers = ($__createClass)({
    constructor: function() {
      EventEmitter.call(this);
      this._queues = new Queues(this);
      this._scheduler = new Scheduler(this);
    },
    queue: function(name) {
      return this._queues.getQueue(name);
    },
    schedule: function(name, time, job) {
      this._scheduler.schedule(name, time, job);
    },
    configure: function(config) {
      this._config = config;
    },
    start: function() {
      this._scheduler.start();
      this._queues.start();
    },
    stop: function() {
      this._scheduler.stop();
      this._queues.stop();
    },
    fulfill: function() {
      var $__6;
      for (var args = [], $__1 = 0; $__1 < arguments.length; $__1++) args[$__1] = arguments[$__1];
      return ($__6 = runner).fulfill.apply($__6, $__toObject(args));
    },
    once: function(callback) {
      var promise = this._scheduler.once().then((function() {
        return this._queues.once();
      }).bind(this)).then((function() {
        this.debug("Completed all jobs");
      }).bind(this));
      return returnPromiseOrCallback(promise, callback);
    },
    reset: function(callback) {
      var promise = this._queues.reset(callback);
      return returnPromiseOrCallback(promise, callback);
    },
    debug: function(message) {
      for (var args = [], $__2 = 1; $__2 < arguments.length; $__2++) args[$__2 - 1] = arguments[$__2];
      this.emit('debug', format.apply(null, $__spread([message], args)));
    },
    info: function(message) {
      for (var args = [], $__3 = 1; $__3 < arguments.length; $__3++) args[$__3 - 1] = arguments[$__3];
      this.emit('info', format.apply(null, $__spread([message], args)));
    },
    error: function(messageOrError) {
      for (var args = [], $__4 = 1; $__4 < arguments.length; $__4++) args[$__4 - 1] = arguments[$__4];
      if (messageOrError instanceof Error) this.emit('error', messageOrError); else {
        var message = format.apply(null, $__spread([messageOrError], args));
        this.emit('error', new Error(message));
      }
    }
  }, {}, $__proto, $__super, true);
  return $Workers;
}(EventEmitter);
module.exports = new Workers();
var $__Object = Object, $__getOwnPropertyNames = $__Object.getOwnPropertyNames, $__getOwnPropertyDescriptor = $__Object.getOwnPropertyDescriptor, $__getDescriptors = function(object) {
  var descriptors = {}, name, names = $__getOwnPropertyNames(object);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    descriptors[name] = $__getOwnPropertyDescriptor(object, name);
  }
  return descriptors;
}, $__createClassNoExtends = function(object, staticObject) {
  var ctor = object.constructor;
  Object.defineProperty(object, 'constructor', {enumerable: false});
  ctor.prototype = object;
  Object.defineProperties(ctor, $__getDescriptors(staticObject));
  return ctor;
}, $__TypeError = TypeError, $__toObject = function(value) {
  if (value == null) throw $__TypeError();
  return $__Object(value);
}, $__spread = function() {
  var rv = [], k = 0;
  for (var i = 0; i < arguments.length; i++) {
    var value = $__toObject(arguments[i]);
    for (var j = 0; j < value.length; j++) {
      rv[k++] = value[j];
    }
  }
  return rv;
};
var _ = require('lodash');
var assert = require('assert');
var fivebeans = require('fivebeans');
var ms = require('ms');
var runJob = require('./runner').runJob;
var RESERVE_TIMEOUT = ms('30s');
var RESERVE_BACKOFF = ms('30s');
var TIMEOUT_REQUEST = RESERVE_TIMEOUT + ms('10s');
var PROCESSING_TIMEOUT = ms('10m');
var RELEASE_DELAY = ms('1m');
var Configuration = function() {
  'use strict';
  var $Configuration = ($__createClassNoExtends)({
    constructor: function(workers) {
      this._workers = workers;
    },
    get config() {
      var config = this._config;
      if (!config) {
        var source = this._workers._config && this._workers._config.queues;
        if (!source) source = (process.env.NODE_ENV == 'test') ? {prefix: 'test-'}: {};
        this._config = config = {
          hostname: source.hostname || 'localhost',
          port: source.port || 11300,
          prefix: source.prefix,
          width: source.width || 1
        };
        if (source.token) {
          config.authenticate = 'oauth ' + source.token + ' ' + source.projectID;
          config.webhookURL = 'https://' + source.hostname + '/1/projects/' + source.projectID + '/queues/{queueName}/messages/webhook?oauth=' + source.token;
        } else {
          config.authenticate = null;
          config.webhookURL = 'https://<host>/1/projects/<project>/queues/{queueName}/messages/webhook?oauth=<token>';
        }
      }
      return config;
    },
    get hostname() {
      return this.config.hostname;
    },
    get port() {
      return this.config.port;
    },
    prefixedName: function(queueName) {
      return (this.config.prefix || '') + queueName;
    },
    get authenticate() {
      return this.config.authenticate;
    },
    get width() {
      return this.config.width;
    },
    webhookURL: function(queueName) {
      return this.config.webhookURL.replace('{queueName}', queueName);
    }
  }, {});
  return $Configuration;
}();
module.exports = (function() {
  'use strict';
  var Server = ($__createClassNoExtends)({
    constructor: function(workers) {
      this.notify = workers;
      this.config = new Configuration(workers);
      this._queues = Object.create({});
    },
    getQueue: function(name) {
      assert(name, "Missing queue name");
      var queue = this._queues[name];
      if (!queue) {
        queue = new Queue(name, this);
        this._queues[name] = queue;
      }
      return queue;
    },
    start: function() {
      this.notify.debug("Start all queues");
      _.values(this._queues).forEach(function(queue) {
        queue.start();
      });
    },
    stop: function(callback) {
      this.notify.debug("Stop all queues");
      _.values(this._queues).forEach(function(queue) {
        queue.stop();
      });
    },
    reset: function() {
      this.notify.debug("Clear all queues");
      var queues = _.values(this._queues);
      var promises = queues.map((function(queue) {
        return queue.reset();
      }));
      return Promise.all(promises);
    },
    once: function() {
      this.notify.debug("Process all queued jobs");
      var queues = _.values(this._queues);
      var promise = new Promise(function(resolve, reject) {
        function runAllJobsOnce() {
          var all = Promise.all(queues.map((function(queue) {
            return queue.once();
          })));
          all.then((function(processed) {
            var anyProcessed = processed.indexOf(true) >= 0;
            if (anyProcessed) setImmediate(runAllJobsOnce); else resolve();
          }), reject);
        }
        runAllJobsOnce();
      });
      return promise;
    }
  }, {});
  return Server;
}());
var Session = function() {
  'use strict';
  var $Session = ($__createClassNoExtends)({
    constructor: function(name, server, setup) {
      this.name = name;
      this.config = server.config;
      this.notify = server.notify;
      this.setup = setup;
    },
    request: function(command) {
      for (var args = [], $__1 = 1; $__1 < arguments.length; $__1++) args[$__1 - 1] = arguments[$__1];
      var promise = new Promise((function(resolve, reject) {
        function makeRequest(client) {
          var $__4;
          try {
            var requestTimeout = setTimeout(function() {
              reject('TIMED_OUT');
            }, TIMEOUT_REQUEST);
            ($__4 = client[command]).call.apply($__4, $__spread([client], args, [function(error) {
              for (var results = [], $__2 = 1; $__2 < arguments.length; $__2++) results[$__2 - 1] = arguments[$__2];
              clearTimeout(requestTimeout);
              if (error) reject(error); else if (results.length > 1) resolve(results); else resolve(results[0]);
            }]));
          } catch (error) {
            reject(error);
          }
        }
        this.connect().then(makeRequest, (function(error) {
          this.promise = null;
          reject(error);
        }).bind(this));
      }).bind(this));
      return promise;
    },
    connect: function() {
      if (this.promise) return this.promise;
      var client = new fivebeans.client(this.config.hostname, this.config.port);
      var promise = new Promise((function(resolve, reject) {
        var authenticateAndSetup = (function() {
          if (this.config.authenticate) {
            client.put(0, 0, 0, this.config.authenticate, function(error) {
              if (error) {
                reject(error);
                client.destroy();
              } else setupAndResolve();
            });
          } else setupAndResolve();
        }).bind(this);
        var setupAndResolve = (function() {
          this.setup(client, (function(error) {
            if (error) {
              reject(error);
              client.destroy();
            } else resolve(client);
          }));
        }).bind(this);
        client.on('connect', authenticateAndSetup).on('error', (function(error) {
          this.promise = null;
          reject(error);
          this.notify.info("Client error in queue %s: %s", this.name, error.toString());
          client.end();
        }).bind(this)).on('close', (function() {
          this.promise = null;
          this.notify.info("Connection closed for %s", this.name);
          client.end();
        }).bind(this));
        client.connect();
      }).bind(this));
      this.promise = promise;
      return promise;
    }
  }, {});
  return $Session;
}();
var Queue = function() {
  'use strict';
  var $Queue = ($__createClassNoExtends)({
    constructor: function(name, server) {
      this.name = name;
      this.notify = server.notify;
      this.webhookURL = server.config.webhookURL(name);
      this._server = server;
      this._prefixedName = server.config.prefixedName(name);
      this._processing = false;
      this._handlers = [];
      this._reserveSessions = [];
    },
    get _put() {
      var session = this._putSession;
      if (!session) {
        session = new Session(this.name, this._server, (function(client, callback) {
          client.use(this._prefixedName, callback);
        }).bind(this));
        this._putSession = session;
      }
      return session;
    },
    _reserve: function(index) {
      var session = this._reserveSessions[index];
      if (!session) {
        session = new Session(this.name, this._server, (function(client, callback) {
          client.ignore('default', (function() {
            client.watch(this._prefixedName, callback);
          }).bind(this));
        }).bind(this));
        this._reserveSessions[index] = session;
      }
      return session;
    },
    push: function(job, callback) {
      assert(job, "Missing job to queue");
      var priority = 0;
      var delay = 0;
      var timeToRun = Math.floor(PROCESSING_TIMEOUT / 1000);
      var payload = JSON.stringify(job);
      var promise = this._put.request('put', priority, delay, timeToRun, payload);
      if (callback) {
        promise.then((function() {
          return setImmediate(callback);
        }), (function(error) {
          return callback(error);
        }));
      } else return promise;
    },
    each: function(handler, width) {
      assert(typeof handler == 'function', "Called each without a valid handler");
      this._handlers.push(handler);
      if (width) this._width = width;
      if (this._processing) this.start();
    },
    start: function() {
      this._processing = true;
      for (var i = 0; i < this.width; ++i) {
        var session = this._reserve(i);
        this._processContinously(session);
      }
    },
    stop: function() {
      this._processing = false;
    },
    get width() {
      return this._width || this._server.config.width || 1;
    },
    once: function() {
      assert(!this._processing, "Cannot call once while continuously processing jobs");
      if (!this._handlers.length) return Promise.resolve(false);
      this.notify.debug("Waiting for jobs on queue %s", this.name);
      if (this.width == 1) {
        var session = this._reserve(0);
        return this._processOnce(session);
      } else {
        var promises = [];
        for (var i = 0; i < this.width; ++i) {
          var session = this._reserve(i);
          promises.push(this._processOnce(session));
        }
        var anyProcessed = Promise.all(promises);
        anyProcessed.then((function(processed) {
          return processed.indexOf(true) >= 0;
        }));
        return anyProcessed;
      }
    },
    _processOnce: function(session) {
      return new Promise((function(resolve, reject) {
        var timeout = 0;
        session.request('reserve_with_timeout', timeout).then((function($__3) {
          var jobID = $__3[0], payload = $__3[1];
          return this._runAndDestroy(session, jobID, payload);
        }).bind(this)).then((function() {
          return resolve(true);
        }), (function(error) {
          if (error == 'TIMED_OUT' || (error && error.message == 'TIMED_OUT')) resolve(false); else reject(error);
        }));
      }).bind(this));
    },
    _processContinously: function(session) {
      if (!(this._processing && this._handlers.length)) return;
      var repeat = (function() {
        this._processContinously(session);
      }).bind(this);
      this.notify.debug("Waiting for jobs on queue %s", this.name);
      var timeout = RESERVE_TIMEOUT / 1000;
      session.request('reserve_with_timeout', timeout).then((function($__3) {
        var jobID = $__3[0], payload = $__3[1];
        return this._runAndDestroy(session, jobID, payload);
      }).bind(this)).then(repeat, (function(error) {
        if (error == 'TIMED_OUT' || (error && error.message == 'TIMED_OUT')) setImmediate(repeat); else {
          this.notify.error(error);
          setTimeout(repeat, RESERVE_BACKOFF);
        }
      }).bind(this));
    },
    _runAndDestroy: function(session, jobID, payload) {
      var promise = this._runJob(jobID, payload.toString());
      promise.then((function() {
        return session.request('destroy', jobID);
      }), (function(error) {
        var priority = 0;
        var delay = (process.env.NODE_ENV == 'test' ? 0: Math.floor(RELEASE_DELAY / 1000));
        session.request('release', jobID, priority, delay). catch ((function(error) {
          return this.notify.error(error);
        }).bind(this));
      }).bind(this));
      return promise;
    },
    _runJob: function(jobID, payload) {
      var jobSpec = {
        id: [this.name, jobID].join(':'),
        notify: this.notify,
        handlers: this._handlers,
        timeout: PROCESSING_TIMEOUT - ms('1s')
      };
      try {
        var job = JSON.parse(payload);
        this.notify.debug("Processing job %s", jobSpec.id, job);
        return runJob(jobSpec, job);
      } catch (ex) {
        this.notify.debug("Processing job %s", jobSpec.id, payload);
        return runJob(jobSpec, payload);
      }
    },
    reset: function() {
      var session = this._put;
      var promise = new Promise(function(resolve, reject) {
        function deleteReady() {
          session.request('peek_ready').then((function($__3) {
            var jobID = $__3[0], payload = $__3[1];
            return session.request('destroy', jobID);
          })).then(deleteReady). catch ((function(error) {
            if (error == 'NOT_FOUND') deleteDelayed(); else reject(error);
          }));
        }
        function deleteDelayed() {
          session.request('peek_delayed').then((function($__3) {
            var jobID = $__3[0], payload = $__3[1];
            return session.request('destroy', jobID);
          })).then(deleteDelayed). catch ((function(error) {
            if (error == 'NOT_FOUND') resolve(); else reject(error);
          }));
        }
        deleteReady();
      });
      return promise;
    }
  }, {});
  return $Queue;
}();
var $__TypeError = TypeError, $__Object = Object, $__toObject = function(value) {
  if (value == null) throw $__TypeError();
  return $__Object(value);
}, $__spread = function() {
  var rv = [], k = 0;
  for (var i = 0; i < arguments.length; i++) {
    var value = $__toObject(arguments[i]);
    for (var j = 0; j < value.length; j++) {
      rv[k++] = value[j];
    }
  }
  return rv;
};
var assert = require('assert');
var co = require('co');
var createDomain = require('domain').createDomain;
module.exports.runJob = function($__2) {
  var id = $__2.id, notify = $__2.notify, timeout = $__2.timeout, handlers = $__2.handlers;
  for (var args = [], $__0 = 1; $__0 < arguments.length; $__0++) args[$__0 - 1] = arguments[$__0];
  notify.info("Processing job %s", id);
  var domain = createDomain();
  var errorOnTimeout;
  if (timeout) {
    errorOnTimeout = setTimeout(function() {
      domain.emit('error', new Error("Timeout processing job " + id));
    }, timeout);
    domain.add(errorOnTimeout);
  }
  var sequence = handlers.reduce(function(promise, handler) {
    return promise.then((function() {
      return promiseFromHandler(handler);
    }));
  }, Promise.resolve());
  function promiseFromHandler(handler) {
    var promise = new Promise(function(resolve, reject) {
      domain.on('error', reject);
      domain.run(function() {
        var result = handler.apply(null, $__spread(args, [domain.intercept(resolve)]));
        if (result) {
          if (typeof (result.then) == 'function') {
            result.then(resolve, reject);
          } else {
            co(result)(function(error) {
              if (error) reject(error); else resolve();
            });
          }
        }
      });
    });
    return promise;
  }
  sequence.then(function() {
    clearTimeout(errorOnTimeout);
    notify.info("Completed job %s", id);
  }, function(error) {
    clearTimeout(errorOnTimeout);
    notify.error("Error processing job %s: %s", id, error.stack);
  });
  return sequence;
};
module.exports.fulfill = function() {
  for (var args = [], $__1 = 0; $__1 < arguments.length; $__1++) args[$__1] = arguments[$__1];
  var fn;
  if (args.length > 1) {
    try {
      throw undefined;
    } catch (method) {
      try {
        throw undefined;
      } catch (object) {
        try {
          throw undefined;
        } catch ($__3) {
          {
            $__3 = args;
            object = $__3[0];
            method = $__3[1];
          }
          if (typeof (method) == 'function') fn = method.bind(object); else fn = object[method].bind(object);
        }
      }
    }
  } else fn = args[0];
  assert(typeof (fn) == 'function', "Must call callback with a function");
  var promise = new Promise(function(resolve, reject) {
    function callback(error, value) {
      if (error) reject(error); else resolve(value);
    }
    setImmediate(function() {
      fn(callback);
    });
  });
  return promise;
};
var $__Object = Object, $__getOwnPropertyNames = $__Object.getOwnPropertyNames, $__getOwnPropertyDescriptor = $__Object.getOwnPropertyDescriptor, $__getDescriptors = function(object) {
  var descriptors = {}, name, names = $__getOwnPropertyNames(object);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    descriptors[name] = $__getOwnPropertyDescriptor(object, name);
  }
  return descriptors;
}, $__createClassNoExtends = function(object, staticObject) {
  var ctor = object.constructor;
  Object.defineProperty(object, 'constructor', {enumerable: false});
  ctor.prototype = object;
  Object.defineProperties(ctor, $__getDescriptors(staticObject));
  return ctor;
};
var _ = require('lodash');
var assert = require('assert');
var CronJob = require('cron');
var runJob = require('./runner').runJob;
var DEVELOPMENT_CRON_TIME = '*/5 * * * * *';
module.exports = (function() {
  'use strict';
  var Scheduler = ($__createClassNoExtends)({
    constructor: function(workers) {
      this.notify = workers;
      this._development = process.env.NODE_ENV == 'development';
      this._cronJobs = Object.create({});
      this._startJobs = false;
    },
    schedule: function(name, time, job) {
      assert(job instanceof Function, "Third argument must be the job function");
      assert(!this._cronJobs[name], "Attempt to schedule multiple jobs with same name (" + name + ")");
      var cronTime = this._development ? DEVELOPMENT_CRON_TIME: time;
      var jobSpec = {
        id: name,
        notify: this.notify,
        handlers: [job]
      };
      var cronJob = CronJob.job(cronTime, (function() {
        return runJob(jobSpec);
      }));
      cronJob.name = name;
      this._cronJobs[name] = cronJob;
      if (this._startJobs) {
        this.notify.debug("Starting cronjob %s", name);
        cronJob.start();
      }
    },
    start: function() {
      this._startJobs = true;
      _.values(this._cronJobs).forEach((function(cronJob) {
        this.notify.debug("Starting cronjob %s", cronJob.name);
        cronJob.start();
      }).bind(this));
    },
    stop: function() {
      this._startJobs = false;
      _.values(this._cronJobs).forEach((function(cronJob) {
        this.notify.debug("Stopping cronjob %s", cronJob.name);
        cronJob.stop();
      }).bind(this));
    },
    once: function() {
      var cronJobs = _.values(this._cronJobs);
      var promises = cronJobs.map((function(cronJob) {
        return cronJob._callbacks[0]();
      }));
      return Promise.all(promises);
    }
  }, {});
  return Scheduler;
}());
