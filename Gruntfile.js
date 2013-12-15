module.exports = function(grunt) {

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-notify');
  grunt.loadNpmTasks('grunt-traceur');


  grunt.config('traceur', {
    options: {
      blockBinding: true,
      modules:      true,
      sourceMaps:   true
    },
    files: {
      expand: true,
      cwd:  'src',
      src:  '**/*.js',
      dest: 'lib/',
      ext:  '.js'
    }
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
  

  grunt.registerTask('build', "Compile source files from src/ into lib/ directory",
                     [ 'clean', 'traceur', 'notify:build' ]);
  grunt.registerTask('default', "Continously compile source files (build and watch)",
                     [ 'build', 'watch' ]);

}
