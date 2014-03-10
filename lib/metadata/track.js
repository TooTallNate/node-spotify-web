
/**
 * Module dependencies.
 */

var schemas = require('../schemas');
var util = require('../util');
var SpotifyUri = require('../uri');
var Metadata = require('./metadata');
var PlaySession = require('./play_session');
var PassThrough = require('stream').PassThrough;
var inherits = require('util').inherits;
var debug = require('debug')('spotify-web:metadata:track');

// node v0.8.x compat
if (!PassThrough) PassThrough = require('readable-stream/passthrough');

/**
 * Protocol Buffer types.
 */

var StoryRequest = schemas.build('bartender','StoryRequest');
var StoryList = schemas.build('bartender','StoryList');

/**
 * Module exports.
 */

module.exports = Track;

/**
 * Constants
 */

const previewUrlBase = 'http://d318706lgtcm8e.cloudfront.net/mp3-preview/';

/**
 * Creates a new Track instance with the specified uri, or in the case of multiple uris, 
 * creates an array of new Track instances.
 *
 * Instances will only contain a URI and will not have metadata populated
 *
 * @param {Object} spotify Spotify object instance
 * @param {Array|String} uris A single URI, or an Array of URIs to get Track instances for
 * @param {Function} (Optional) fn callback function
 * @return {Array|Track}
 * @api public
 */

Track.get = util.bind(Metadata.get, null, Track);

/**
 * Check whether the class supports construction from a specific schema/object
 *
 * @param {Object} schema
 * @return {Boolean}
 * @api private
 */

Track._acceptsSchema = util.bind(Metadata._acceptsSchema, null, 'track');

/**
 * Track class.
 *
 * @api public
 */

function Track (spotify, uri, parent) {
  if (!(this instanceof Track)) return new Track(spotify, uri, parent);
  this.playSession = null;
  this.type = 'track';

  Metadata.call(this, spotify, uri, parent);
}
inherits(Track, Metadata);
Track['$inject'] = ['Spotify'];

/** 
 * Re-export namespaces
 */
util.export(Track, [ PlaySession ]);

Track.prototype._acceptsSchema = Track._acceptsSchema;

/**
 * Creates a new play session for the given Track object, including the URL to access the audio data.
 *
 * @param {String} (Optional) format One of 'MP3_96' (30 second preview) or 'MP3_160' (default)'
 * @param {String} (Optional) transport One of 'http' (default) or 'rtmp'
 * @param {Function} fn callback
 */
Track.prototype.audioUrl = function(format, transport, fn) {
  // argument surgery
  if ('function' == typeof transport) {
    fn = transport;
    transport = null;
  }
  if ('function' == typeof format) {
    fn = format;
    format = transport = null;
  }
  if (null === format) format = 'MP3_160';
  if (null === transport) transport = 'http';

  debug('audioUrl(%j, %j)', format, transport);

  // we can't do anything if we're not loaded...
  if (!this._loaded) return this.get(util.deferCallback(this.audioUrl.bind(this, format, transport), fn));

  //if (!this._loaded) return this.get(this.audioUrl.bind(this, format, transport, fn));

  // handle 30 second preview format separately
  if ('MP3_96' == format) {
    var preview = this.preview.filter(function(preview) {
      return (preview.format == format);
    });
    // TODO(adammw): recurse alternatives
    if (!preview.length) {
      return process.nextTick(fn.bind(null, new Error('No preview available')));
    }
    var url = previewUrlBase + preview[0].fileId.toString('hex');
    this.playSession = new this.PlaySession({ uri: url });
    return process.nextTick(fn.bind(null, null, this.playSession));
  } 

  var self = this;
  var spotify = this._spotify;
  this.recurseAlternatives(spotify.user_info.country || 'US', function (err, track) {
    if (err) return fn(err);
    var args = [ 'mp3160', track.uri.gid.toString('hex'), ('rtmp' == transport) ? 'rtmp' : '' ];
    debug('sp/track_uri args: %j', args);
    (new spotify.Request('sp/track_uri', args)).send(function (err, res) {
      if (err) return fn(err);
      self.playSession = new self.PlaySession(res.result);
      fn(null, self.playSession);
    });
  });
};

/**
 * Checks if the given track "metadata" object is "available" for playback, taking
 * account for the allowed/forbidden countries, the user's current country, the
 * user's account type (free/paid), etc.
 *
 * @param {String} (Optional) country 2 letter country code to check if the track is playable for
 * @param {Function} fn callback with signature `function(err, result){}` where result is true if track is playable, false otherwise
 * @api public
 */

Track.prototype.available = function (country, fn) {
  // argument surgery
  if ('function' == typeof country) {
    fn = country;
    country = null;
  } 
  debug('available(%j)', country);

  var self = this;
  var spotify = this._spotify;

  // make sure we are loaded before trying to read the track's restrictions
  if (!this._loaded) return this.get(util.deferCallback(this.available.bind(this, country), fn));

  // if the track was checked for restrictions on the server side then 
  // it should be available as long as there are no restrictions
  if (this._prerestricted) {
    debug('track was loaded with restrictions applied from server, available = %j', !this.restriction);
    return process.nextTick(fn.bind(null, null, !this.restriction));
  }

  // default to the user's country
  if (!country) country = spotify.user_info.country;

  var allowed = [];
  var forbidden = [];
  var available = false;
  var restriction;

  if (Array.isArray(this.restriction)) {
    debug('checking track restrictions...');
    for (var i = 0; i < this.restriction.length; i++) {
      restriction = this.restriction[i];
      allowed.push.apply(allowed, restriction.allowed);
      forbidden.push.apply(forbidden, restriction.forbidden);

      var isAllowed = !restriction.hasOwnProperty('countriesAllowed') || util.has(allowed, country);
      var isForbidden = util.has(forbidden, country) && forbidden.length > 0;

      // TODO(adammw): fix names, ensure code is correct
      // guessing at names here, corrections welcome...
      var accountTypeMap = {
        premium: 'SUBSCRIPTION',
        unlimited: 'SUBSCRIPTION',
        free: 'AD'
      };

      if (util.has(allowed, country) && util.has(forbidden, country)) {
        isAllowed = true;
        isForbidden = false;
      }

      var type = accountTypeMap[spotify.user_info.catalogue] || 'AD';
      var applicable = util.has(restriction.catalogue, type);

      available = isAllowed && !isForbidden && applicable;

      //debug('restriction: %j', restriction);
      debug('type: %j', type);
      debug('allowed: %j', allowed);
      debug('forbidden: %j', forbidden);
      debug('isAllowed: %j', isAllowed);
      debug('isForbidden: %j', isForbidden);
      debug('applicable: %j', applicable);
      debug('available: %j', available);

      if (available) break;
    }
  }
  process.nextTick(fn.bind(null, null, available));
};

/**
 * Checks if the given "track" is "available". If yes, returns the "track"
 * untouched. If no, then the "alternative" tracks array on the "track" instance
 * is searched until one of them is "available", and then returns that "track".
 * If none of the alternative tracks are "available", returns `null`.
 *
 * @param {String} country 2 letter country code to attempt to find a playable "track" for
 * @param {Function} fn callback function
 * @api public
 */

Track.prototype.recurseAlternatives = function (country, fn) {
  var self = this;
  debug('recurseAlternatives(%j)', country);
  
  // check if the current track is available
  this.available(country, function(err, available) {
    if (err) return fn(err);
    if (available) return fn(null, self);
    if (!Array.isArray(self.alternative)) return fn(new Error('[no alternatives]Track is not playable in country "' + country + '"'));
    
    // check if any alternatives are available
    var tracks = self.alternative.slice(0);
    (function next() {
      var track = tracks.shift();
      if (!track) {
        // not playable
        return fn(new Error('[none left]Track is not playable in country "' + country + '"'));
      }
      debug('checking alternative track %j', track.uri);
      track.available(country, function(err, available) {
        if (available) return fn(null, track);
        next();
      });
    })();
  });
};

/**
 * Retrieve suggested similar tracks to the current track instance
 * 
 * @param {Function} fn callback function
 * @return {Array} an array of Track instances, that are semi-populated with name and artist images
 * @api public
 */

Track.prototype.similar = function(fn) {
  debug('similar()');  

  var spotify = this._spotify;

  var request = new spotify.HermesRequest('hm://similarity/suggest/' + this.uri.sid);
  request.setRequestSchema(StoryRequest);
  request.setResponseSchema(StoryList);
  request.send({
    country: spotify.user_info.country || 'US',
    language: spotify.user_info.preferred_locale || spotify.settings.locale.current || 'en',
    device: 'web'
  }, function(err, res) {
    if (err) return fn(err);

    // normalise response into Metadata objects
    var recommendations = res.result.stories.map(function(story) {
      var data = Object.create(null);

      (function objectify(recommendedItem) {
        var type = SpotifyUri.uriType(recommendedItem.uri);
        var className = type.charAt(0).toUpperCase() + type.substr(1).toLowerCase();
        data[type] = new spotify[className](recommendedItem.uri);
        data[type].name = recommendedItem.displayName;
        if (recommendedItem.parent) objectify(recommendedItem.parent);
      })(story.recommendedItem);

      var track = data.track;
      if (story.preview) {
        track.preview = story.preview.map(function(preview) {
          return {
            fileId: new Buffer(preview.fileId, 'hex'),
            format: 'MP3_96'
          };
        });
      }

      if (data.album) track.album = data.album;
      if (data.artist) { 
        if (story.metadata && story.metadata.summary) data.artist.biography = {text: story.metadata.summary};
        if (story.heroImage) data.artist.portrait = story.heroImage.map(function(image) {
          return {
            fileId: new Buffer(image.fileId, 'hex'),
            width: image.width,
            height: image.height
          };
        });
        if (track.album) track.album.artist = data.artist;
        track.artist = [ data.artist ];
      }
      return track;
    });
    
    fn(null, recommendations);
  });
};

/**
 * Begins playing this track, returns a Readable stream that outputs audio data.
 *
 * @param {String} (Optional) format One of 'MP3_96' (30 second preview) or 'MP3_160' (default)'
 * @param {Function} (Optional) fn callback with signature `function(err, stream)` or `function(stream)`
 * @return {Stream|Null}
 * @api public
 */

Track.prototype.play = function (format, fn) {
  // argument surgery
  if ('function' == typeof format) {
    fn = format;
    format = null;
  }

  // ugly hacks for backwards compat
  var stream = null;
  if ('function' != typeof fn) {
    stream = new PassThrough();
  }
  var callback = function(err, data) {
    if (err && ('function' != typeof fn || ('function' == typeof fn && fn.length == 1))) {
      process.nextTick(stream.emit.bind(stream, 'error', err));
    } else if ('function' == typeof fn) {
      return fn(err, data);
    } 
    if ('function' == typeof fn) fn(data);
  };
  
  // request a play session
  this.audioUrl(format, function (err, session) {
    if (err) return callback(err);

    if ('function' != typeof fn) {
      session.stream.pipe(stream);
    }

    session.play(fn);
  });

  // return stream immediately so it can be .pipe()'d or null if we are using callbacks
  return stream;
};

/**
 * Begins playing a preview of the track, returns a Readable stream that outputs MP3 data.
 *
 * @param {Function} (Optional) fn callback with signature `function(err, stream)` or `function(stream)`
 * @return {Stream|Null}
 * @api public
 */

Track.prototype.playPreview = function (fn) {
  return this.play('MP3_96', fn);
};
