const Traceur = require('traceur');


// All JS files, excluding node_modules, are transpiled using Traceur.
Traceur.require.makeDefault(function(filename) {
  return !(/\/node_modules\//.test(filename));
}, {
  asyncFunctions:  true,
  validate:        true
});
