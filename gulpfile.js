const clean   = require('gulp-clean');
const git     = require('gulp-git');
const gulp    = require('gulp');
const notify  = require('gulp-notify');
const OS      = require('os');
const replace = require('gulp-replace');
const spawn   = require('child_process').spawn;
const traceur = require('gulp-traceur');


// Compile then watch -> compile
gulp.task('default', function() {
  gulp.run('clean', 'build');
  gulp.watch('src/**/*.js', function() {
    gulp.run('build');
  });
});


// Compile ES6 in src to ES5 in lib
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
  // Notifications only available on Mac
  if (OS.type() == 'Darwin')
    compile.pipe(notify({ message: "Ironium: built!", onLast: true }));
});

// Delete anything compiled into lib directory
gulp.task('clean', function() {
  gulp.src('lib/**', {read: false }).pipe(clean());
});

// Run mocha, used by release task
gulp.task('test', function(callback) {
  const mocha = spawn('mocha', [], { stdio: 'inherit' });
  mocha.on('close', function(code) {
    if (code)
      callback(new Error('Mocha exited with code ' + code));
    else
      callback();
  });
});


// Tag the release and npm publish
gulp.task('release', ['clean', 'build', 'test'], function() {
  gulp.src('./package.json')
    .pipe(git.add('package.json CHANGELOG.md'))
    .pipe(git.commit("Release <%= jsonFile.version %>", "--allow-empty"))
    .pipe(git.tag("<%= jsonFile.version %>", "Release <%= jsonFile.version %>", true))
    .pipe(git.push());
    //.pipe(exec('npm publish'))
});
