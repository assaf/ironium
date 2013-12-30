# 0.9.1

Configuration gets separate section for setting up Iron.io server.


# 0.9.0

Scheduler now queues job for execution, this will allow using a scheduler
service.

Scheduler now accepts scheduled time as either Date, interval (number or
string), or an object with start time, end time and interval.


# 0.8.0

Methods like `once`, `reset` and `push` now return thunks instead of promises.
Disappointing for some, but easier for those of us using
[Mocha](http://visionmedia.github.io/mocha/) and
[co](https://github.com/visionmedia/co).


# 0.7.3

Testing with [Travis-CI](https://travis-ci.org/assaf/ironium).


# 0.7.2

Fixed: need Error object when reporting connection closed


# 0.7.1

Use [monolithed/ECMAScript-6](https://github.com/monolithed/ECMAScript-6) to
implement promises.


# 0.7.0

Removed `workers.fulfill`, please use
[thunks](https://github.com/visionmedia/co#thunks-vs-promises) instead.

Minor performance improvement.


# 0.6.0

Removed `workers.push` and `workers.each`, referencing queues is better for
testing.

Renamed count to width (number of workers used in parallel).

Tests!


# 0.5.3

Allow multiple queue handlers.

Added `workers.push`, `workers.each` and `workers.webhookURL` convenience
methods.


# 0.5.2

Using [co](https://github.com/visionmedia/co).


# 0.5.1

Added `workers.fulfill` to ease using generators with callbacks.

Added documentation for logging.


# 0.5.0

Preliminary support for generators.


# 0.4.0

Use native Promise instead of Q.
