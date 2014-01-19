const clean   = require('gulp-clean');
const exec    = require('gulp-exec');
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

// Run mocha, used by release task
gulp.task('test', function(callback) {
  return gulp.src('test').pipe(exec('mocha'));
});


// Tag the release and npm publish
gulp.task('element', function() {
  const version = require('./package.json').version;
  return gulp.src('element.svg')
    .pipe(replace(/<tspan id="version">[\d\.]+<\/tspan>/, '<tspan id="version">' + version + '</tspan>'))
    .pipe(gulp.dest('.'));
          
});
gulp.task('release', ['clean', 'build', 'test', 'element'], function() {
  const version = require('./package.json').version;
  const message = "Release " + version;
  return gulp.src('package.json')
    .pipe(exec('git add package.json CHANGELOG.md element.svg'))
    .pipe(exec('git commit --allow-empty -m "' + message + '"'))
    .pipe(exec('git tag version -m "' + message + '"'))
    .pipe(exec('git push origin master'))
    .pipe(exec('npm publish'))
});
