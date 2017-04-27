// Returns AWS configuration for testing.
// Includes a prefix so Travis jobs don't interfere with each other.
module.exports = function getAWSConfig() {
  const accessKeyId     = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region          = 'us-east-1';
  const configWithPrefx = {
    accessKeyId,
    secretAccessKey,
    region,
    prefix:           process.env.TEST_PREFIX
  };
  return configWithPrefx;
};

module.exports.isAvailable = !!process.env.AWS_ACCESS_KEY_ID;
