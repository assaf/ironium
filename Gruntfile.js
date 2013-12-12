module.exports = function(grunt) {

  grunt.loadNpmTasks('grunt-contrib-clean');
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

  grunt.config('clean', [ 'lib' ]);


  grunt.registerTask('build', [ 'clean', 'traceur' ]);
  grunt.registerTask('default', [ 'build' ]);

}
