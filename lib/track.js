
/**
 * Module dependencies.
 */

var util = require('./util');
var Track = require('./schemas').build('metadata','Track');
var PassThrough = require('stream').PassThrough;
var debug = require('debug')('spotify-web:track');

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
 * Track Preview URL getter
 */
Object.defineProperty(Track.prototype, 'previewUrl', {
  get: function () {
    var previewUrlBase = 'http://d318706lgtcm8e.cloudfront.net/mp3-preview/'
    return this.preview.length && (previewUrlBase + util.gid2id(this.preview[0].fileId));
  },
  enumerable: true,
  configurable: true
})

/**
 * Loads all the metadata for this Track instance. Useful for when you get an only
 * partially filled Track instance from an Album instance for example.
 *
 * @param {Function} fn callback function
 * @api public
 */

Track.prototype.get =
Track.prototype.metadata = function (fn) {
  if (this._loaded) {
    // already been loaded...
    debug('track already loaded');
    return process.nextTick(fn.bind(null, null, this));
  }
  var spotify = this._spotify;
  var self = this;
  spotify.get(this.uri, function (err, track) {
    if (err) return fn(err);
    // extend this Track instance with the new one's properties
    Object.keys(track).forEach(function (key) {
      if (track.hasOwnProperty(key)) {
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
  if (track && track._playSession) {
    spotify.sendTrackEnd(track._playSession.lid, track.uri, track.duration);
    track._playSession = null;
  }

  // set this Track instance as the "currentTrack"
  spotify.currentTrack = track = this;

  // initiate a "play session" for this Track
  spotify.trackUri(track, function (err, res) {
    if (err) return stream.emit('error', err);
    if (!res) return stream.emit('error', new Error('response was null'));
    if (!res.uri) return stream.emit('error', new Error('response contained no "uri"'));
    debug('GET %s', res.uri);
    track._playSession = res;
    var req = spotify.agent.get(res.uri)
      .set({ 'User-Agent': spotify.userAgent })
      .end()
      .request();
    req.on('response', response);
  });

  function response (res) {
    debug('HTTP/%s %s', res.httpVersion, res.statusCode);
    if (res.statusCode == 200) {
      res.pipe(stream);
    } else {
      stream.emit('error', new Error('HTTP Status Code ' + res.statusCode));
    }
  }

  // return stream immediately so it can be .pipe()'d
  return stream;
};

/**
 * Begins playing a preview of the track, returns a Readable stream that outputs MP3 data.
 *
 * @api public
 */

Track.prototype.playPreview = function () {
  var spotify = this._spotify;
  var stream = new PassThrough();
  var previewUrl = this.previewUrl;

  if (!previewUrl) {
    process.nextTick(function() {
      stream.emit('error', new Error('Track does not have preview available'));
    });
    return stream;
  }

  debug('GET %s', previewUrl);
  var req = spotify.agent.get(previewUrl)
    .set({ 'User-Agent': spotify.userAgent })
    .end()
    .request();
  req.on('response', response);

  function response (res) {
    debug('HTTP/%s %s', res.httpVersion, res.statusCode);
    if (res.statusCode == 200) {
      res.pipe(stream);
    } else {
      stream.emit('error', new Error('HTTP Status Code ' + res.statusCode));
    }
  }

  // return stream immediately so it can be .pipe()'d
  return stream;
};

/**
 * Returns an mp3 url and handles play session correctly
 *
 * @api public
 */

Track.prototype.getStreamURL = function (callback) {
    // TODO: add formatting options once we figure that out
    var spotify = this._spotify;

    // if a song was playing before this, the "track_end" command needs to be sent
    var track = spotify.currentTrack;
    if (track && track._playSession) {
        spotify.sendTrackEnd(track._playSession.lid, track.uri, track.duration);
        track._playSession = null;
    }

    // set this Track instance as the "currentTrack"
    spotify.currentTrack = track = this;

    // initiate a "play session" for this Track
    spotify.trackUri(track, function(err, trackResponse) {
        if (err) console.log(err);
        track._playSession = trackResponse;
        callback.call(this, err, trackResponse)
    });
};