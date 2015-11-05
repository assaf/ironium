'use strict';
require('../helpers');
const assert   = require('assert');
const Bluebird = require('bluebird');
const Ironium  = require('../..');
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

  socket.on('data', dumbProtocol);
  socket.unref();

	function dumbProtocol(data) {
    if (killer)
      clearTimeout(killer);

		const lines = data.toString().trim().split(/\r\n/);
		nextLine(lines, socket);

    killer = setTimeout(function() {
      socket.end();
    }, 2000);
	}

	function nextLine(lines, socket) {
		const line = lines[0];
		if (line) {
			const parts = line.split(' ');
			const cmd 	= parts[0];

			switch (cmd) {
				case 'delete':
					if (reserved.has(socket)) {
						socket.write(`DELETED\r\n`);
						reserved.delete(socket);
					} else
						socket.write(`NOT_FOUND\r\n`);
					break;

				case 'ignore':
					socket.write(`WATCHING 1\r\n`);
					break;

				case 'list-tubes-watched':
					socket.write(`OK 0\r\n`);
					break;

				case 'peek-ready':
				case 'peek-delayed':
					if (jobs === 0)
						socket.write(`FOUND ${jobs} 3\r\nfoo\r\n`);
					else
						socket.write(`NOT_FOUND\r\n`);
					break;

				case 'reserve':
				case 'reserve-with-timeout':
					if (jobs === 0) {
						jobs++;
						socket.write(`RESERVED ${reserved.size} 3\r\nfoo\r\n`);
						reserved.set(socket, 1);
					} else
						socket.write(`TIMED_OUT\r\n`);
					break;

				case 'use':
					socket.write(`USING ${parts[1]}\r\n`);
					break;

				case 'watch':
					socket.write(`WATCHING 1\r\n`);
					break;

				default:
					throw new Error(`Unknown mock command "${cmd}".`);
			}
			nextLine(lines.slice(1), socket);
		}
	}

});



describe('Server with keep-alive needs', ()=> {

  before(() => {
    Ironium.configure({
      queues: { hostname: '127.0.0.1', port: 11334, keepAlive: '1500' }
    });

    mock.listen(11334);
  });

  describe('long-running jobs', ()=> {

		before(function() {
      Ironium.queue('foo').eachJob(function() {
        assert.equal(reserved.size, 1);
        return Bluebird.delay(3000);
      });

      return Ironium.runOnce();
		});

    it('should be processed and deleted', function() {
      assert.equal(reserved.size, 0);
    });

  });

  after(() => {
    Ironium.configure({
      queues: { hostname: '127.0.0.1', port: 11300 }
    });
  });

});

