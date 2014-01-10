const clean   = require('gulp-clean');
const gulp    = require('gulp');
const notify  = require('gulp-notify');
const release = require('gulp-release');
const replace = require('gulp-replace');
const spawn   = require('child_process').spawn;
const traceur = require('gulp-traceur');


gulp.task('default', function() {
  // Compile then watch -> compile
  gulp.run('clean', 'build');
  gulp.watch('src/**/*.js', function() {
    gulp.run('build');
  });
});


gulp.task('build', function() {
  const options = {
    blockBinding: true,
    sourceMaps:   true,
    modules:      'commonjs'
  };
  gulp.src('src/**/*.js')
    .pipe(traceur(options))
    .pipe(replace("module.exports = {};", ""))
    .pipe(gulp.dest('lib'))
    .pipe(notify({ message: "Ironium: built!" }));
});

gulp.task('clean', function() {
  gulp.src('lib/**', {read: false }).pipe(clean());
});

gulp.task('test', ['clean', 'build'], function(callback) {
  spawn('mocha', [], { stdio: 'inherit' }, callback);
});


gulp.task('release', ['clean', 'test'], function() {
  return gulp.src('package.json')
    .pipe(release({
      commit: {
        files: [ '-a' ],
        message: 'Release <%= package.version %>'
      },
      publish: false // explicitly pass false will skip this step
    }));
});
