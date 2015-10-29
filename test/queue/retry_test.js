require('../helpers');
const assert  = require('assert');
const Ironium = require('../../src');
const Net     = require('net');


// This Beanstalk mock will close the connection when receiving
// the first N jobs, then work normally.

let jobs = 0;
let failUntil = 1;

const mock = Net.createServer(function(socket) {
  socket.on('data', function(data) {
    const parts = data.toString().replace(/\r\n$/, '').split(' ');
    const cmd = parts[0];

    let reply;

    switch (cmd) {
      case 'use':
        reply = `USING ${parts[1]}`;
        break;
      case 'peek-ready':
      case 'peek-delayed':
        reply = 'NOT_FOUND';
        break;
      case 'put':
        jobs++;

        if (jobs < failUntil)
          socket.end();
        else
          reply = `INSERTED ${jobs}`;

        break;

      default:
        throw new Error(`Unknown mock command "${cmd}".`);
    }

    if (reply)
      socket.write(`${reply}\r\n`);
  });

  socket.unref();
});


describe('Server with errors', ()=> {

  before(() => {
    Ironium.configure({
      queues: { hostname: '127.0.0.1', port: 11333 }
    });

    mock.listen(11333);
  });

  describe('fail then recover', ()=> {

    it('should not error when queuing', async ()=> {
      await Ironium.queue('foo').queueJob({ value: 1 });
    });

  });

  describe('continously fail', ()=> {
    before(()=> {
      jobs = 0;
      failUntil = 3;
    });

    it('should throw error when queueing', async ()=> {
      try {
        await Ironium.queue('foo').queueJob({ value: 1 });
        assert(false, 'Expected to throw an error');
      } catch (error) {
        assert.equal(error.message, 'Error queuing to foo: CLOSED');
      }
    });

  });

  after(() => {
    Ironium.configure({
      queues: { hostname: '127.0.0.1', port: 11300 }
    });
  });

});

