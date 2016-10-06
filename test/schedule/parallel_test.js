'use strict';
const assert         = require('assert');
const fork           = require('child_process').fork;
const ironcache      = require('iron-cache');
const ironCacheMutex = require('../../lib/iron_cache_mutex');
const Ironium        = require('../..');
const ms             = require('ms');
const nock           = require('nock');
const Redis          = require('ioredis');
const redisMutex     = require('../../lib/redis_mutex');


const isMocha = !!global.describe;

if (isMocha)
  runTestSuite();
else
  runChildProcess(process.env.mutex, process.env.leader === 'true');


function runTestSuite() {

  describe('Three parallel workers', function() {

    describe('no coordination', function() {

      before(Ironium.purgeQueues);

      it('should schedule the job three times', function() {
        const promises  = [1, 2, 3].map(forkChildProcess());
        return Promise.all(promises)
          .then(function(scheduled) {
            const total = scheduled.reduce(sum);
            assert.equal(total, 3);
          });
      });

    });


    describe('coordinate using Redis', function() {

      before(function() {
        const redis = new Redis({ db: 9 });
        return redis.flushdb();
      });
      before(Ironium.purgeQueues);

      it('should schedule job once', function() {
        const promises  = [1, 2, 3].map(forkChildProcess('redis'));
        return Promise.all(promises)
          .then(function(scheduled) {
            const total = scheduled.reduce(sum);
            assert.equal(total, 1);
          });
      });

    });


    describe('coordinate using IronCache', function() {

      before(Ironium.purgeQueues);

      it('should schedule job once', function() {
        const promises  = [1, 2, 3].map(forkChildProcess('cache'));
        return Promise.all(promises)
          .then(function(scheduled) {
            const total = scheduled.reduce(sum);
            assert.equal(total, 1);
          });
      });

    });

  });

}


function sum(a, b) {
  return a + b;
}


// fn(mutex) -> fn(index) -> promise(count)
//
// Will fork one child process using the named mutex, will wait for it to run
// for a few seconds, and count how many times it executed the scheduled job.
//
// With coordination, only one child process will be able to schedule a job, and
// one child process (not necessarily same one) will execute it.
//
// Without coordination, all child processes will schedule one job each, and
// they will all attempt to execute as many jobs as they can (not necessarily
// 1:1).
function forkChildProcess(mutex) {
  return function(index) {
    return new Promise(function(resolve, reject) {
      const leader = (index === 1);
      const env = {
        NODE_ENV: 'test',
        DEBUG:    process.env.DEBUG,
        mutex,
        leader
      };
      const child = fork(module.filename, { env, stdio: 'inherit' });

      let count = 0;
      child.on('message', function() {
        ++count;
      });
      child.on('exit', function(code) {
        if (code)
          reject(new Error('Exited with code ' + code));
        else
          resolve(count);
      });
    });
  };
}


function runChildProcess(coordinator, leader) {

  useCoordinator(coordinator, leader);

  const soon    = new Date(Date.now() + ms('100ms'));
  const timeout = ms('2s');

  Ironium.start();

  Ironium.scheduleJob('parallel', soon, function() {
    process.send('executed');
    return Promise.resolve();
  });

  setTimeout(function() {
    process.exit(0);
  }, timeout);
}


function useCoordinator(coordinator, leader) {
  switch (coordinator) {
    case 'redis' : {
      useRedisToCoordinate();
      break;
    }
    case 'cache': {
      useIronCacheToCoordinate(leader);
      break;
    }
  }
}

function useRedisToCoordinate() {
  const redis = new Redis({ db: 9 });
  Ironium.configure({ canScheduleJob: redisMutex(redis) });
}

function useIronCacheToCoordinate(leader) {
  const project  = '5643';
  const token    = '0000';

  const cache   = ironcache.createClient({ project, token });
  Ironium.configure({ canScheduleJob: ironCacheMutex(cache) });

  stubIronCache(leader, project, token);
}

function stubIronCache(leader, project, token) {
  const endpoint = `/1/projects/${project}/caches/ironium:schedule/items/parallel?oauth=${token}`;
  const put      = nock('https://cache-aws-us-east-1.iron.io').put(endpoint);
  if (leader)
    put.reply(200, { msg: 'Stored.' });
  else
    put.reply(400, { msg: 'Key already exists.' });
}
