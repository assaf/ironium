const exec        = require('child_process').exec;
const File        = require('fs');
const gulp        = require('gulp');
const gutil       = require('gulp-util');
const Net         = require('net');
const replace     = require('gulp-replace');
const spawn       = require('child_process').spawn;
const version     = require('./package.json').version;


// Restart beanstalkd (OS X only)
// Make sure we're running with a clean slate
gulp.task('restart', function(done) {
  if (process.platform !== 'darwin') {
    done();
    return;
  }

  gutil.log('Restarting beanstalkd ...');
  exec('launchctl stop homebrew.mxcl.beanstalk', function(error, stdout) {
    process.stdout.write(stdout);
    exec('launchctl start homebrew.mxcl.beanstalk', function(error, stdout) {
      process.stdout.write(stdout);
      gutil.log('Waiting for beanstalkd ...');
      connect();
    });
  });

  function connect() {
    const connection = Net.connect({ port: 11300 });
    connection.on('connect', function() {
      connection.end();
      done();
    });
    connection.on('error', function() {
      setTimeout(connect, 100);
    });
  }
});




// Used by gulp release to update element.svg with new version number.
gulp.task('element', function() {
  return gulp.src('element.svg')
    .pipe(replace(/<tspan id='version'>[\d\.]+<\/tspan>/, `<tspan id="version">${version}</tspan>`))
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
  const script  =  `\
    git add package.json CHANGELOG.md element.svg   &&\
    git commit --allow-empty -m \"" + message + "\" &&\
    git push origin master                          &&\
    git tag -a " + version + " --file change.log    &&\
    git push origin " + version + "                 &&\
    git clean -f`;
  exec(script, function(error, stdout) {
    process.stdout.write(stdout);
    callback(error);
  });
});

gulp.task('release', function(done) {
  spawn('npm', ['publish'], { stdio: 'inherit' }, done);
});

