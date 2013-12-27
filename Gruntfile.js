var File    = require('fs');
var Traceur = require('traceur');


module.exports = function(grunt) {

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-notify');
  grunt.loadNpmTasks('grunt-release');


  grunt.registerTask('compile', function() {
    File.mkdirSync('lib');
    File.readdirSync('src').forEach(function(filename) {

      var source = File.readFileSync('src/' + filename, 'utf8');
      var options = {
        blockBinding: true,
        sourceMaps:   true,
        modules:      'commonjs',
        filename:     filename
      };
      var output = Traceur.compile(source, options);
      if (output.errors.length) {
        throw new Error(output.errors.join('\n'));
      } else {
        var clean = output.js.replace("module.exports = {};", "");
        File.writeFileSync('lib/' + filename, clean, 'utf8');
        grunt.log.ok('src/' + filename + ' => lib/' + filename);
      }

    });
  });

  grunt.config('watch', {
    files:    [ 'src/**/*.js' ],
    tasks:    [ 'build' ],
    options:  { interrupt: true }
  });

  grunt.config('clean', [ 'lib' ]);

  grunt.config.set('notify.notify_hooks', {
    options: { enabled: true }
  });

  grunt.config('notify.build', {
    options: { message: "Build complete!" }
  });
  

  grunt.registerTask('build', "Compile source files from src/ into index.js",
                     [ 'clean', 'compile', 'notify:build' ]);
  grunt.registerTask('default', "Continously compile source files (build and watch)",
                     [ 'build', 'watch' ]);

}
