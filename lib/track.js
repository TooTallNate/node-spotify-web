
/**
 * Module dependencies.
 */

var Track = require('./schemas').metadata['spotify.metadata.proto.Track'];
var PassThrough = require('stream').PassThrough;

// node v0.8.x compat
if (!PassThrough) PassThrough = require('readable-stream/passthrough');

/**
 * Module exports.
 */

exports = module.exports = Track;

/**
 * Begins playing this track, returns a Readable stream that outputs MP3 data.
 *
 * @api public
 */

Track.prototype.play = function () {
  // TODO: add formatting options once we figure that out
  var spotify = this._spotify;
  var stream = new PassThrough();

  spotify.trackUri(this, function (err, res) {
    if (err) return stream.emit('error', err);
    if (!res.uri) return stream.emit('error', new Error('response contained no "uri"'));
    spotify.agent.get(res.uri).pipe(stream);
  });

  // return stream immediately so it can be .pipe()'d
  return stream;
};
