// canScheduleJob using Redis to coordinate and decide which one worker is
// allowed to schedule the job

const PREFIX      = 'ironium:schedule:';
const TTL_SECONDS = 60;


module.exports = function(redis) {
  return function(jobName, timestamp) {
    const keyName = `${PREFIX}${jobName}`;
    return redis.set(keyName, timestamp, 'EX', TTL_SECONDS, 'NX')
      .then(result => result === 'OK');
  };
};
