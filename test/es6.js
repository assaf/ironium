const File    = require('fs');
const Module  = require('module');
const traceur = require('traceur');


// All JS files, excluding node_modules, are transpiled using Traceur.
const originalRequireJs = Module._extensions['.js'];
Module._extensions['.js'] = function(module, filename) {
  if (/\/node_modules\//.test(filename)) {
    return originalRequireJs(module, filename);
  } else {
    const source = File.readFileSync(filename, 'utf8');
    const compiled = traceur.compile(source, {
      blockBinding:   true,
      asyncFunctions: true,
      validate:       true,
      filename:       filename,
    });
    if (compiled.errors.length)
      throw new Error(compiled.errors.join('\n'));
    return module._compile(compiled.js, filename);
  }
};
