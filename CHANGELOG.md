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
