'use strict';

const assert  = require('assert');
const Ironium = require('../..');
const setup   = require('../helpers');
const Stream  = require('stream');


class SourceStream extends Stream.Readable {

  constructor(stopAt) {
    super({ objectMode: true });
    this._count   = 0;
    this._stopAt  = stopAt;
  }

  _read() {
    if (this._count >= this._stopAt)
      this.push(null);
    else {
      this._count++;
      this.push(this._count);
    }
  }
}


describe('Stream', function() {

  const streamQueue = Ironium.queue('stream');
  const source      = new SourceStream(100);

  before(setup);

  // Capture processed jobs here.
  const jobs = [];
  before(function() {
    streamQueue.eachJob(function(job) {
      jobs.push(job);
      return Promise.resolve();
    });
  });

  // Capture job IDs
  const jobIDs = [];
  before(function(done) {
    source.pipe(streamQueue.stream())
      .on('data', id => jobIDs.push(id))
      .on('end', done);
  });

  before(Ironium.runOnce);

  it('should queue all jobs', function() {
    assert.equal(jobs.length, 100);
  });

  it('should queue jobs in order', function() {
    assert.equal(jobs[0],   '1');
    assert.equal(jobs[10],  '11');
    assert.equal(jobs[99],  '100');
  });

  it('should provide queued job IDs', function() {
    assert.equal(jobIDs.length, 100);
    for (const id of jobIDs)
      assert(/^\d+$/.test(id));
  });

});

