require('../helpers');
const assert   = require('assert');
const Bluebird = require('bluebird');
const Ironium  = require('../../src');
const Net      = require('net');

const reserved = new Map();
let   jobs     = 0;

// This Beanstalk mock behaves like IronMQ with respect to connection handling:
//
// - It will drop the connection if no data is received within 2 seconds
//   (IronMQ does 60 seconds).
//
// - Jobs can only be deleted from the connection that reserved them.
//
// For easier testing, this server emulates a queue with a single job
// to be processed (so that you can call runOnce and drain it).
//
const mock = Net.createServer(function(socket) {
  let killer;

  socket.on('data', function(data) {
    if (killer)
      clearTimeout(killer);

    const parts = data.toString().replace(/\r\n$/, '').split(' ');
    const cmd   = parts[0];
    let   reply;

    switch (cmd) {
      case 'use':
        reply = `USING ${parts[1]}`;
        break;
      case 'watch':
      case 'ignore':
        reply = `WATCHING 1`;
        break;
      case 'list-tubes-watched':
        reply = 'OK 0';
        break;
      case 'peek-ready':
      case 'peek-delayed':
        if (jobs === 0)
          reply = `FOUND ${jobs} 3\r\nfoo`;
        else
          reply = 'NOT_FOUND';
        break;
      case 'reserve':
      case 'reserve-with-timeout':
        if (jobs === 0) {
          jobs++;
          reply = `RESERVED ${reserved.size} 3\r\nfoo`;
          reserved.set(socket, 1);
        }
        else
          reply = 'TIMED_OUT';
        break;
      case 'delete':
        if (reserved.has(socket)) {
          reply = `DELETED`;
          reserved.delete(socket);
        }
        else
          reply = 'NOT_FOUND';
        break;
      default:
        throw new Error(`Unknown mock command "${cmd}".`);
    }

    if (reply)
      socket.write(`${reply}\r\n`);

    killer = setTimeout(function() {
      socket.end();
    }, 2000);
  });

  socket.unref();
});


describe('Server with keep-alive needs', ()=> {

  before(() => {
    Ironium.configure({
      queues: { hostname: '127.0.0.1', port: 11334, keepAlive: '1500' }
    });

    mock.listen(11334);
  });

  describe('long-running jobs', ()=> {

    it('should be processed and deleted', async ()=> {
      Ironium.queue('foo').eachJob(async (body)=> {
        assert.equal(reserved.size, 1);
        await Bluebird.delay(3000);
      });

      await Ironium.runOnce();

      assert.equal(reserved.size, 0);
    });

  });

  after(() => {
    Ironium.configure({
      queues: { hostname: '127.0.0.1', port: 11300 }
    });
  });

});

