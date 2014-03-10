
/**
 * Module dependencies.
 */

var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var PassThrough = require('stream').PassThrough;
var debug = require('debug')('spotify-web:metadata:track:playsession');

// node v0.8.x compat
if (!PassThrough) PassThrough = require('readable-stream/passthrough');

/**
 * Module exports.
 */

module.exports = PlaySession;

/**
 * PlaySession class.
 *
 * @api public
 */

function PlaySession(track, args) {
  EventEmitter.call(this);

  this._defaultCallback = this._defaultCallback.bind(this);
  this._req = null;
  this._started = null;
  this._track = track;
  this.aborted = false;
  this.ended = false;
  this.stream = new PassThrough();
  this.lid = args.lid || null; 
  this.tid = args.tid || null;
  this.type = args.type || null;
  this.uri = args.uri || null;
}
inherits(PlaySession, EventEmitter);
PlaySession['$inject'] = ['Track'];

/**
 * Default callback function for when the user does not pass a
 * callback function of their own.
 *
 * @param {Error} err
 * @api private
 */

PlaySession.prototype._defaultCallback = function (err) {
  if (err) this.emit('error', err);
};

/**
 * Abort downloading a playing track
 */
PlaySession.prototype.abort = function() {
  debug('abort()');
  // TODO(adammw): check the download hasn't already finished
  if (this.aborted === false && this._started) {
    this.aborted = true;
    this._req.abort();
    this._req.res.unpipe(this.stream);
    process.nextTick(this.emit.bind(this, 'abort'));
  }
};

/**
 * Begins playing this track, returns a Readable stream that outputs MP3 data.
 *
 * @param {Function} (Optional) fn callback with signature `function(err, stream)` or `function(stream)`
 * @return {Stream}
 * @api public
 */

PlaySession.prototype.play = function(fn) {
  debug('play()');

  var self = this;
  var spotify = this._track._spotify;
  var stream = this.stream; 

  var callback = function(err, data) {
    if (err && ('function' != typeof fn || ('function' == typeof fn && fn.length == 1))) {
      process.nextTick(self.emit.bind(self, 'error', err)); 
      process.nextTick(stream.emit.bind(stream, 'error', err));
    } else if ('function' == typeof fn) {
      return fn(err, data);
    } 
    if ('function' == typeof fn) fn(data);
  };

  // we only play once...
  if (this._started) {
    return callback(new Error('PlaySession already started'));
  }

  // TODO(adammw): implement rtmp handling
  if (/^rtmp(t|e|s){0,2}:\/\//.test(this.uri)) {
    return callback(new Error('TODO: implement rtmp transport!'));
  }

  this._started = true;
  
  // if a song was playing before this, the "track_end" command needs to be sent
  var session = spotify.currentPlaySession;
  if (session && !session.ended) session.end();

  // set this PlaySession instance as the "currentPlaySession"
  spotify.currentPlaySession = this;

  // make the GET request to the uri
  debug('GET %s', this.uri);
  this._req = spotify.agent.get(this.uri)
    .set({ 'User-Agent': spotify.userAgent })
    .end()
    .request();
  this._req.on('response', function(res) {
    debug('HTTP/%s %s', res.httpVersion, res.statusCode);
    if (res.statusCode == 200) {
      self._started = Date.now();
      res.pipe(stream);
      process.nextTick(self.emit.bind(self, 'response', res));
      process.nextTick(self.emit.bind(self, 'stream', stream));
      callback(null, stream);
    } else {
      callback(new Error('HTTP Status Code ' + res.statusCode));
    }
  });

  // return stream immediately so it can be .pipe()'d
  return stream;
};

/**
 * Sends the "sp/track_end" event. This is required after each track is played,
 * otherwise Spotify limits you to 3 track URL fetches per session.
 *
 * @param {Number} (Optional) ms number of milliseconds played, defaults to track duration or time existed, whichever is lesser
 * @param {Function} (Optional) fn callback function
 * @api public
 */

PlaySession.prototype.end = function (ms, fn) {  
  // argument surgery
  if ('function' == typeof ms) {
    fn = ms;
    ms = null;
  }
  if (null === ms) {
    ms = Math.min(this._track.duration, Date.now() - this._started);
  }

  if (!fn) fn = this._defaultCallback;

  if (this.ended) return process.nextTick(fn.bind(null, new Error('PlaySession ended')));

  debug('sendTrackEnd(%j, %j, %j)', this.lid, this._track.uri, ms);

  this.ended = true;

  var ms_played = Number(ms);
  var ms_played_union = ms_played;
  var n_seeks_forward = 0;
  var n_seeks_backward = 0;
  var ms_seeks_forward = 0;
  var ms_seeks_backward = 0;
  var ms_latency = 100;
  var display_track = null;
  var play_context = 'unknown';
  var source_start = 'unknown';
  var source_end = 'unknown';
  var reason_start = 'unknown';
  var reason_end = 'unknown';
  var referrer = 'unknown';
  var referrer_version = '0.1.0';
  var referrer_vendor = 'com.spotify';
  var max_continuous = ms_played;
  var args = [
    this.lid,
    ms_played,
    ms_played_union,
    n_seeks_forward,
    n_seeks_backward,
    ms_seeks_forward,
    ms_seeks_backward,
    ms_latency,
    display_track,
    play_context,
    source_start,
    source_end,
    reason_start,
    reason_end,
    referrer,
    referrer_version,
    referrer_vendor,
    max_continuous
  ];

  var spotify = this._track._spotify;
  var request = new spotify.Request('sp/track_end', args);
  request.send(function (err, res) {
    if (err) return fn(err);
    if (null === res.data) {
      // apparently no result means "ok"
      fn();
    } else {
      // TODO: handle error case
      debug('non-null sp/track_end result: %j', res.data);
    }
  });
};

/**
 * Sends the "sp/track_event" event. These are pause and play events (possibly
 * others).
 *
 * @param {String} event
 * @param {Number} (Optional) ms number of milliseconds played so far
 * @param {Function} (Optional) fn callback function
 * @api public
 */

PlaySession.prototype.event = function (event, ms, fn) {
  // argument surgery
  if ('function' == typeof ms) {
    fn = ms;
    ms = null;
  }
  if (null === ms) {
    ms = Math.min(this._track.duration, Date.now() - this._started);
  }

  if (!fn) fn = this._defaultCallback;

  if (this.ended) return process.nextTick(fn.bind(null, new Error('PlaySession ended')));

  debug('sendTrackEvent(%j, %j, %j)', this.lid, event, ms);

  var num = event;
  var args = [ this.lid, num, ms ];

  var spotify = this._track._spotify;
  var request = new spotify.Request('sp/track_event', args);
  request.send(function (err, res) {
    if (err) return fn(err);
    if (null === res.data) {
      // apparently no result means "ok"
      fn();
    } else {
      // TODO: handle error case
      debug('non-null sp/track_event result: %j', res.data);
    }
  });
};

/**
 * Sends the "sp/track_progress" event. Should be called periodically while
 * playing a Track.
 *
 * @param {Number} (Optional) ms number of milliseconds played so far
 * @param {Function} (Optional) fn callback function
 * @api public
 */

PlaySession.prototype.progress = function (lid, ms, fn) {
  // argument surgery
  if ('function' == typeof ms) {
    fn = ms;
    ms = null;
  }
  if (null === ms) {
    ms = Math.min(this._track.duration, Date.now() - this._started);
  }

  if (!fn) fn = this._defaultCallback;

  if (this.ended) return process.nextTick(fn.bind(null, new Error('PlaySession ended')));

  debug('sendTrackProgress(%j, %j)', this.lid, ms);

  var ms_played = Number(ms);
  var source_start = 'unknown';
  var reason_start = 'unknown';
  var ms_latency = 100;
  var play_context = 'unknown';
  var display_track = '';
  var referrer = 'unknown';
  var referrer_version = '0.1.0';
  var referrer_vendor = 'com.spotify';
  var args = [
    lid,
    source_start,
    reason_start,
    ms_played,
    ms_latency,
    play_context,
    display_track,
    referrer,
    referrer_version,
    referrer_vendor
  ];

  var spotify = this._track._spotify;
  var request = new spotify.Request('sp/track_progress', args);
  request.send(function (err, res) {
    if (err) return fn(err);
    if (null === res.data) {
      // apparently no result means "ok"
      fn();
    } else {
      // TODO: handle error case
      debug('non-null sp/track_progress result: %j', res.data);
    }
  });
};
