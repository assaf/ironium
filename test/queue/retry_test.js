'use strict';
require('../helpers');
const assert  = require('assert');
const Ironium = require('../..');
const Net     = require('net');


// This Beanstalk mock will close the connection when receiving
// the first N jobs, then work normally.

let jobs = 0;
let failUntil = 1;

const mock = Net.createServer(function(socket) {
  socket.on('data', dumbProtocol);
  socket.unref();

  function dumbProtocol(data) {
    const lines = data.toString().trim().split(/\r\n/);
    nextLine(lines, socket);
  }

  function nextLine(lines, socket) {
    const line = lines[0];
    if (line) {
      const parts = line.split(' ');
      const cmd   = parts[0];

      switch (cmd) {
        case 'peek-ready':
        case 'peek-delayed':
          socket.write(`NOT_FOUND\r\n`);
          nextLine(lines.slice(1), socket);
          break;

        case 'put':
          jobs++;

          if (jobs < failUntil)
            socket.end();
          else
            socket.write(`INSERTED ${jobs}\r\n`);
          nextLine(lines.slice(2), socket);
          break;

        case 'use':
          socket.write(`USING ${parts[1]}\r\n`);
          nextLine(lines.slice(1), socket);
          break;

        default:
          throw new Error(`Unknown mock command "${cmd}".`);
      }
    }
  }

});


describe('Server with errors', function() {

  before(function() {
    Ironium.configure({
      host: '127.0.0.1',
      port: 11333
    });

    mock.listen(11333);
  });

  describe('fail then recover', function() {

    it('should not error when queuing', function() {
      return Ironium.queueJob('foo', { value: 1 });
    });

  });

  describe('continously fail', function() {
    before(function() {
      jobs = 0;
      failUntil = 3;
    });

    it('should throw error when queueing', function() {
      return Ironium.queueJob('foo', { value: 1 })
        .then(function() {
          assert(false, 'Expected to throw an error');
        })
        .catch(function(error) {
          assert.equal(error.message, 'Error queuing to foo: CLOSED');
        });
    });

  });

  after(function() {
    Ironium.configure({
      host: '127.0.0.1',
      port: 11300
    });
  });

});

