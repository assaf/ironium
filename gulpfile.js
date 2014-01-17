const clean   = require('gulp-clean');
const git     = require('gulp-git');
const gulp    = require('gulp');
const notify  = require('gulp-notify');
const OS      = require('os');
const replace = require('gulp-replace');
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

const exec = require('gulp-exec');

// Run mocha, used by release task
gulp.task('test', function(callback) {
  return gulp.src('test').pipe(exec('mocha'));
});


// Tag the release and npm publish
gulp.task('element', function() {
  const version = require('./package.json').version;
  gulp.src('element.svg')
    .pipe(replace(/<tspan id="version">.+<\/tspan>/, '<tspan id="version">' + version + '</tspan>'))
    .pipe(gulp.dest('.'));
          
});
gulp.task('release', ['clean', 'build', 'test', 'element'], function() {
  const version = require('./package.json').version;
  return gulp.src('package.json')
    .pipe(git.add('package.json CHANGELOG.md element.svg'))
    .pipe(git.commit("Release " + version, '--allow-empty'))
    .pipe(git.tag(version, "Release " + version, true))
    .pipe(git.push())
    .pipe(exec('npm publish'))
});
