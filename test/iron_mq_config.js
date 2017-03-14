const File = require('fs');


// Returns IronMQ configuration for testing.
// Includes a prefix so Travis jobs don't interfere with each other.
module.exports = function getIronMQConfig() {
  const ironMQConfig    = JSON.parse(File.readFileSync('iron.json'));
  const configWithPrefx = Object.assign({}, ironMQConfig, {
    prefix: process.env.TRAVIS_JOB_ID
  });
  return configWithPrefx;
};
