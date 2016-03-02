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
            const count = scheduled.filter(i => i).length;
            assert.equal(count, 3);
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
            const count = scheduled.filter(i => i).length;
            assert.equal(count, 1);
          });
      });

    });


    describe('coordinate using IronCache', function() {

      before(Ironium.purgeQueues);

      it('should schedule job once', function() {
        const promises  = [1, 2, 3].map(forkChildProcess('cache'));
        return Promise.all(promises)
          .then(function(scheduled) {
            const count = scheduled.filter(i => i).length;
            assert.equal(count, 1);
          });
      });

    });

  });

}


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
      child.on('message', resolve);
      child.on('exit', function(code) {
        reject(new Error('Exited with code ' + code));
      });
      setTimeout(function() {
        resolve(false);
        child.kill();
      }, ms('10s'));
    });
  };
}


function runChildProcess(coordinator, leader) {

  useCoordinator(coordinator, leader);

  const in1Second  = new Date(Date.now() + ms('1s'));
  Ironium.scheduleJob('parallel', in1Second, function(done) {
    process.send('executed');
    Ironium.stop();
    done();
  });

  Ironium.start();

  // Wait, otherwise process exits without processing any jobs.
  setTimeout(function() {}, ms('10s'));
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
