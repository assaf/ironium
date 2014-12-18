const del     = require('del');
const exec    = require('child_process').exec;
const File    = require('fs');
const gulp    = require('gulp');
const Net     = require('net');
const notify  = require('gulp-notify');
const OS      = require('os');
const Path    = require('path');
const replace = require('gulp-replace');
const spawn   = require('child_process').spawn;
const Traceur = require('traceur');
const through = require('through2');
const version = require('./package.json').version;


// Compile then watch -> compile
gulp.task('default', ['build'], function() {
  gulp.watch('src/**/*.js', function() {
    gulp.run('build');
  });
});


// Compile ES6 in src to ES5 in lib
gulp.task('build', ['clean'], function() {
  const options = {
    asyncFunctions:  true,
    validate:        true,
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
gulp.task('clean', function(done) {
  del('lib/**', done);
});


// Restart beanstalkd (OS X only)
// Make sure we're running with a clean slate
gulp.task('restart', function(done) {
  if (process.platform !== 'darwin') {
    done();
    return;
  }

  console.log('Restaring beanstalkd ...');
  exec('launchctl stop homebrew.mxcl.beanstalk', function(error, stdout, stderr) {
    process.stdout.write(stdout);
    exec('launchctl start homebrew.mxcl.beanstalk', function(error, stdout, stderr) {
      process.stdout.write(stdout);
      console.log('Waiting for beanstalkd ...');
      connect();
    });
  });

  function connect() {
    const connection = Net.connect({ port: 11300 });
    connection.on('connect', function() {
      connection.end();
      done();
    });
    connection.on('error', function(error) {
      setTimeout(connect, 100);
    });
  }
});


// Runs the test suite
//
// Rebuild ES5 source files in lib directory, one of the test suites runs in ES5
// Restart Beanstalkd, make sure we're running from a clean slate
gulp.task('test', ['build', 'restart'], function(done) {
  spawn('mocha', [], { stdio: 'inherit' }, done);
});


// Used by gulp release to update element.svg with new version number.
gulp.task('element', function() {
  return gulp.src('element.svg')
    .pipe(replace(/<tspan id="version">[\d\.]+<\/tspan>/, '<tspan id="version">' + version + '</tspan>'))
    .pipe(gulp.dest('.'));
          
});

// Used by gulp release to create a changelog summary in change.log.
gulp.task('changelog', function(callback) {
  // Get the most recent tag
  exec('git describe --abbrev=0 --tags', function(error, stdout) {
    const tag = stdout.trim();
    // Get summary of all commits since that tag
    exec('git log ' + tag + '..HEAD --pretty=format:%s%n', function(error, stdout) {
      const log = stdout;
      File.writeFile('change.log', log, 'utf-8', callback);
    });
  });
});

// Used by npm publish to create a Version N.N commit and tag it.
gulp.task('tag-release', ['element', 'changelog'], function(callback) {
  const message = "Release " + version;
  const script  =  "\
    git add package.json CHANGELOG.md element.svg   &&\
    git commit --allow-empty -m \"" + message + "\" &&\
    git push origin master                          &&\
    git tag -a " + version + " --file change.log    &&\
    git push origin " + version + "                 &&\
    git clean -f";
  exec(script, function(error, stdout) {
    process.stdout.write(stdout);
    callback(error);
  });
});

gulp.task('release', function(done) {
  spawn('npm', ['publish'], { stdio: 'inherit' }, done);
});


function es6(options) {
	return through.obj(function(file, encoding, callback) {
		options.filename = Path.basename(file.path);
		try {
			const compiled = Traceur.compile(file.contents.toString(), options);
      file.contents = new Buffer(compiled);
		} catch (error) {
			this.emit('error', error);
		}
		this.push(file);
		callback();
	});
}

