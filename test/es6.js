var Traceur = require('traceur');

// All JS files that are not inside node modules will load using Traceur.
Traceur.require.makeDefault(function(filename) {
  return !(/node_modules/.test(filename));
});

// Required to support let/const
Traceur.options.blockBinding = true;
Traceur.options.generators = true;

