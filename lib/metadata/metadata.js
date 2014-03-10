
/**
 * Module dependencies.
 */

var util = require('../util');
var schemas = require('../schemas');
var SpotifyUri = require('../uri');
var querystring = require('querystring');
var debug = require('debug')('spotify-web:metadata');

/**
 * Module exports.
 */

exports = module.exports = Metadata;

/**
 * Protocol Buffer types.
 */

Metadata.schemas = {
  album: schemas.build('metadata', 'Album'),
  artist: schemas.build('metadata', 'Artist'),
  track: schemas.build('metadata', 'Track'),
};

/**
 * Creates a new Metadata instance with the specified uri, or in the case of multiple uris, 
 * creates an array of new Metadata instances.
 *
 * Instances will only contain a URI and will not have metadata populated
 *
 * @param {Metadata} type
 * @param {Object} spotify Spotify object instance
 * @param {Array|String} uris A single URI, or an Array of URIs to get Metadata instances for
 * @param {Function} (Optional) fn callback function
 * @return {Array|Metadata}
 * @api public
 */

Metadata.get = function(type, spotify, uri, fn) {
  debug('get(%j)', uri);

  // convert input uris to array but save if we should return an array or a bare object
  var returnArray = Array.isArray(uri);
  if (!returnArray) uri = [uri];

  // call the Metadata constructor for each uri, and call the callback if we have an error
  var metadataObjs;
  try {
    metadataObjs = uri.map(type.bind(null, spotify));
  } catch (e) {
    if ('function' == typeof fn) process.nextTick(fn.bind(null, e));
    return null;
  }

  // return the array of metadataObjs or a single metadataObj and call callbacks if applicable
  var ret = (returnArray) ? metadataObjs : metadataObjs[0];
  if ('function' == typeof fn) process.nextTick(fn.bind(null, null, ret));
  return ret;
};
Metadata.get['$inject'] = [null, 'Spotify'];

/**
 * Check whether the class supports construction from a specific schema/object
 *
 * @param {String} type
 * @param {Object} schema
 * @return {Boolean}
 * @api private
 */
Metadata._acceptsSchema = function(type, schema) {
  return (type && Metadata.schemas[type] && schema instanceof Metadata.schemas[type]);
};

/**
 * Merge any pending metadata requests into a multi-GET request if possible
 *
 * @param {Spotify} spotify
 * @api private
 */
Metadata.mergeMultiGetRequests = function(spotify) {
  debug('mergeMultiGetRequests()');
  // TODO(adammw): we should be sending 100 subrequests at most, 
  // and if over this limit they should be split up into batches

  // TODO(adammw): try harder to retain the original ordering of requests

  var multiGet = {
    track: {},
    artist: {},
    album: {}
  };

  var requestQueue = spotify.connection.requestQueue;

  // search for candidates for combination
  for (var i = requestQueue.length - 1; i >= 0; i -= 1) {
    var request = requestQueue[i];
    if (request instanceof spotify.HermesRequest && !request.hasSubrequests()) {
      var match;
      if (request.uri && 'GET' == request.method && (match = /^hm:\/\/metadata\/(track|artist|album)\/[0-9a-f]+(?:\?(.+))?$/.exec(request.uri))) {
        var type = match[1];
        var qs = match[2] || '';
        if (!multiGet[type][qs]) multiGet[type][qs] = [];
        multiGet[type][qs].push(request);
        requestQueue.splice(i, 1);
      }
    }
  } 

  // combine requests on type and querystring
  Object.keys(multiGet).forEach(function(type) {
    Object.keys(multiGet[type]).forEach(function(qs) {
      debug('%d candidates for multiget combination for type: %s and querystring "%s"', multiGet[type][qs].length, type, qs);
      
      var candidates = multiGet[type][qs];
      candidates.reverse(); // requests were extracted from going backwards, so reverse it again to compensate

      // leave single requests unchanged
      var request;
      if (candidates.length == 1) {
        request = candidates[0];
      } else {
        debug('creating new multi-get request for %s with querystring "%s"', type, qs);
        var hm_uri = 'hm://metadata/' + type + 's';
        if (qs) hm_uri += '?' + qs;
        request = new spotify.HermesRequest(hm_uri);
        request.addSubrequests(candidates);
      }

      requestQueue.push(request);
    });
  });
};
Metadata.mergeMultiGetRequests['$inject'] = ['Spotify'];

/**
 * Metadata class.
 *
 * @api public
 */

function Metadata (spotify, uri, parent) {
  if (!(this instanceof Metadata) || !this.type) throw new Error('Invalid use of Metadata object');

  this._spotify = spotify;
  this._parent = parent || null;
  this._loaded = false;
  this._prerestricted = (this._parent instanceof Metadata) ? this._parent._prerestricted : false;

  // if a uri was passed in, ensure it is of the correct type
  if ('string' == typeof uri) uri = new SpotifyUri(uri);
  if (uri instanceof SpotifyUri) {
    if (this.type != uri.type) throw new Error('Invalid URI Type: ' + uri.type);
    this.uri = uri;
    return this; // constructor

  // if an object was passed in, update the object with the properties 
  // of the passed in object only if it is of one of the accepted schemas
  } else if ('object' == typeof uri) {
    if (this._acceptsSchema(uri)) {
      this._update(uri, true);
      return this; // constructor
    }
  }

  throw new Error('ArgumentError: Invalid arguments');  
}
Metadata['$inject'] = ['Spotify'];

/** 
 * Re-export subtypes
 */

var Album = require('./album'); // these require() statements MUST be after all static methods are defined
var Artist = require('./artist');
var Track = require('./track');

util.export(Metadata, [Album, Artist, Track]);

/**
 * Update the Metadata instance with the properties of another object
 *
 * @param {Object} obj
 * @param {Boolean} (Optional) partial set to true if the object is non-authorative to ensure the _loaded flag is not set
 * @api private
 */
Metadata.prototype._update = function(obj, partial) {
  var self = this;
  var spotify = this._spotify;

  // TODO(adammw): update this._prerestricted on all the objects created by spotify._objectify() calls

  if (obj.gid) {
    this.uri = SpotifyUri.fromGid(this.type, obj.gid);
  }

  Object.keys(obj).forEach(function (key) {
    if (!self.hasOwnProperty(key)) {
      self[key] = spotify._objectify(obj[key]);
    }
  });

  if (!partial) this._loaded = true;
};

/**
 * Loads all the metadata for this Metadata instance. 
 *
 * @param {Boolean} (Optional) restrictToAvailable restrict the data loaded to only that which is available to the current user, defaults to true
 * @param {Boolean} (Optional) refresh
 * @param {Function} fn callback function
 * @api public
 */

Metadata.prototype.get =
Metadata.prototype.metadata = function (restrictToAvailable, refresh, fn) {
  // argument surgery
  if ('function' == typeof refresh) {
    fn = refresh;
    refresh = null;
  }
  if ('function' == typeof restrictToAvailable) {
    fn = restrictToAvailable;
    restrictToAvailable = refresh = null;
  }
  if (null === refresh) refresh = false;
  if (null === restrictToAvailable) restrictToAvailable = true;

  debug('metadata(%j)', refresh);

  var self = this;
  var spotify = this._spotify;

  // TODO(adammw): don't send request twice if eg. there are two callbacks, ie set 'requestSent' after first request sent

  if (!refresh && this._loaded) {
    // already been loaded...
    debug('metadata object already loaded');
    return process.nextTick(fn.bind(null, null, this));
  }

  var hm_uri = 'hm://metadata/' + this.type + '/' + this.uri.id;
  // adding the query parameter filters the metadata on the server side to only those
  // that are available for your country / account type, and does not return any restriction 
  // information for alternatives (as they are already filtered)
  if (restrictToAvailable && spotify.user_info) {
    hm_uri += '?' + querystring.stringify({
      country: spotify.user_info.country, 
      catalogue: spotify.user_info.catalogue, 
      locale: spotify.user_info.preferred_locale
    });
    this._prerestricted = true;
  }
  
  var request = new spotify.HermesRequest(hm_uri);
  request.setResponseSchema(Metadata.schemas[this.type]);
  request.send(function(err, res) {
    if (err) return fn(err);
    self._update(res.result);
    fn(null, self);
  });
};
