
/**
 * Module dependencies.
 */

var util = require('./util');
var Track = require('./schemas').metadata['spotify.metadata.proto.Track'];
var PassThrough = require('stream').PassThrough;

// node v0.8.x compat
if (!PassThrough) PassThrough = require('readable-stream/passthrough');

/**
 * Module exports.
 */

exports = module.exports = Track;

/**
 * Track URI getter.
 */

Object.defineProperty(Track.prototype, 'uri', {
  get: function () {
    return util.gid2uri('track', this.gid);
  },
  enumerable: true,
  configurable: true
});

/**
 * Loads all the metadata for this Track instance. Useful for when you get an only
 * partially filled Track instance from an Album instance for example.
 *
 * @param {Function} fn callback function
 * @api public
 */

Track.prototype.get =
Track.prototype.metadata = function (fn) {
  var spotify = this._spotify;
  var self = this;
  spotify.metadata(this.uri, function (err, track) {
    if (err) return fn(err);
    // extend this Track instance with the new one's properties
    Object.keys(track).forEach(function (key) {
      if (!self.hasOwnProperty(key)) {
        self[key] = track[key];
      }
    });
    fn(null, self);
  });
};

/**
 * Begins playing this track, returns a Readable stream that outputs MP3 data.
 *
 * @api public
 */

Track.prototype.play = function () {
  // TODO: add formatting options once we figure that out
  var spotify = this._spotify;
  var stream = new PassThrough();

  // if a song was playing before this, the "track_end" command needs to be sent
  var track = spotify.currentTrack;
  if (track) {
    spotify.sendTrackEnd(track._playSession.lid, track.uri, track.duration);
    track._playSession = null;
  }

  // set this Track instance as the "currentTrack"
  spotify.currentTrack = track = this;

  // initiate a "play session" for this Track
  spotify.trackUri(track, function (err, res) {
    if (err) return stream.emit('error', err);
    if (!res.uri) return stream.emit('error', new Error('response contained no "uri"'));
    track._playSession = res;
    spotify.agent.get(res.uri).pipe(stream);
  });

  // return stream immediately so it can be .pipe()'d
  return stream;
};
