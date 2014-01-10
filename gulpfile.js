const clean   = require('gulp-clean');
const gulp    = require('gulp');
const notify  = require('gulp-notify');
const OS      = require('os');
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
  const compile = gulp.src('src/**/*.js')
    .pipe(traceur(options))
    .pipe(replace("module.exports = {};", ""))
    .pipe(gulp.dest('lib'));
  if (OS.type() == 'Darwin')
    compile.pipe(notify({ message: "Ironium: built!" }));
});

gulp.task('clean', function() {
  gulp.src('lib/**', {read: false }).pipe(clean());
});

gulp.task('test', function(callback) {
  const mocha = spawn('mocha', [], { stdio: 'inherit' });
  mocha.on('close', function(code) {
    if (code)
      callback(new Error('Mocha exited with code ' + code));
    else
      callback();
  });
});


gulp.task('release', ['clean', 'build', 'test'], function() {
  return gulp.src('package.json')
    .pipe(release({
      commit: {
        files: [ '-a' ],
        message: 'Release <%= package.version %>'
      },
      publish: true
    }));
});
