require('./helpers');
const assert     = require('assert');
const Ironium    = require('../src');
const ms         = require('ms');


describe('Scheduled job', ()=> {

  let delta;

  before((done)=> {
    const t1 = Date.now();

    Ironium.scheduleJob('in-2s', new Date(Date.now() + ms('2s')), async function() {
      delta = Date.now() - t1;
      Ironium.stop();
      done();
    });

    Ironium.start();
  });

  it('should not be run job before scheduled time', function() {
    assert(delta > 2000);
  });

});

