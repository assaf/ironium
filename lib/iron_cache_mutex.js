// canScheduleJob using IronCache to coordinate and decide which one worker is
// allowed to schedule the job

const CACHE_NAME  = 'ironium:schedule';
const TTL_SECONDS = 59;


module.exports = function(cache) {
  return function(jobName, timestamp) {
    return new Promise(function(resolve, reject) {
      const keyName = jobName;
      const data = {
        value:      timestamp,
        expires_in: TTL_SECONDS, // eslint-disable-line camelcase
        add:        true
      };
      cache.put(CACHE_NAME, keyName, data, function(error, result) {
        if (result && result.msg === 'Stored.')
          resolve(true);
        else if (error && error.message === 'Key already exists.')
          resolve(false);
        else
          reject(error || new Error(`Unexpected response ${result}`));
      });
    });
  };
};
