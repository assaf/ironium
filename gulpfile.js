const clean   = require('gulp-clean');
const exec    = require('gulp-exec');
const gulp    = require('gulp');
const notify  = require('gulp-notify');
const OS      = require('os');
const Path    = require('path');
const replace = require('gulp-replace');
const traceur = require('traceur');
const through = require('through2');


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
    sourceMaps:     true,
    modules:        'commonjs'
  };
  const compile = gulp.src('src/**/*.js')
    .pipe(es6(options))
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
gulp.task('test', ['build'], function() {
  return gulp.src('test').pipe(exec('mocha'));
});


// Used by gulp release to update element.svg with new version number.
gulp.task('element', function() {
  const version = require('./package.json').version;
  return gulp.src('element.svg')
    .pipe(replace(/<tspan id="version">[\d\.]+<\/tspan>/, '<tspan id="version">' + version + '</tspan>'))
    .pipe(gulp.dest('.'));
          
});

// Used by gulp release to create a changelog summary in change.log.
gulp.task('changelog', function(callback) {
  const Child = require('child_process');
  const File  = require('fs');

    
  // Get the most recent tag
  Child.exec('git describe --abbrev=0 --tags', function(error, stdout) {
    const tag = stdout.trim();
    // Get summary of all commits since that tag
    Child.exec('git log ' + tag + '..HEAD --pretty=format:%s%n', function(error, stdout) {
      const log = stdout;
      File.writeFile('change.log', log, 'utf-8', callback);
    });
  });
});

// Used by npm publish to create a Version N.N commit and tag it.
gulp.task('tag-release', ['element', 'changelog'], function() {
  const version = require('./package.json').version;
  const message = "Release " + version;

  return gulp.src('change.log')
    .pipe(exec('git add package.json CHANGELOG.md element.svg'))
    .pipe(exec('git commit --allow-empty -m "' + message + '"'))
    .pipe(exec('git push origin master'))
    .pipe(exec('git tag -a ' + version + ' --file change.log'))
    .pipe(exec('git push origin ' + version))
    .pipe(clean());
});


function es6(options) {
	return through.obj(function(file, encoding, callback) {
		options.filename = Path.basename(file.path);
		try {
			var output = traceur.compile(file.contents.toString(), options);
      if (output.errors.length > 0)
        this.emit('error', new Error(output.errors.join('\n')));
			if (output.js)
				file.contents = new Buffer(output.js);
		} catch (error) {
			this.emit('error', error);
		}
		this.push(file);
		callback();
	});
}

