module.exports = function(grunt) {

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-notify');
  grunt.loadNpmTasks('grunt-release');
  grunt.loadNpmTasks('grunt-traceur');


  grunt.config('traceur', {
    options: {
      blockBinding: true,
      modules:      true,
      sourceMaps:   true
    },
    files: {
      src:  'src/**/*.js',
      dest: 'index.js'
    }
  });

  grunt.config('watch', {
    files:    [ 'src/**/*.js' ],
    tasks:    [ 'build' ],
    options:  { interrupt: true }
  });

  grunt.config('clean', [ 'index.js' ]);

  grunt.config.set('notify.notify_hooks', {
    options: { enabled: true }
  });

  grunt.config('notify.build', {
    options: { message: "Build complete!" }
  });
  

  grunt.registerTask('build', "Compile source files from src/ into index.js",
                     [ 'clean', 'traceur', 'notify:build' ]);
  grunt.registerTask('default', "Continously compile source files (build and watch)",
                     [ 'build', 'watch' ]);

}
