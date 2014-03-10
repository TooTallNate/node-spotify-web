
/**
 * Module dependencies.
 */

var base62 = require('./base62');
var debug = require('debug')('spotify-web:uri');

/**
 * Module exports.
 */

module.exports = SpotifyUri;

/**
 * Create a new SpotifyUri instance from a given uri type and gid
 * 
 * @param {String} uriType
 * @param {Buffer} gid
 */

SpotifyUri.fromGid = function(uriType, gid) {
  return new SpotifyUri(SpotifyUri.gid2uri(uriType, gid));
};

/**
 * Create a new SpotifyUri instance from a given uri type and id
 * 
 * @param {String} uriType
 * @param {String} id (hexadecimal)
 */

SpotifyUri.fromId = function(uriType, id) {
  return new SpotifyUri(SpotifyUri.id2uri(uriType, gid));
};

/**
 * Create a new SpotifyUri instance from a given uri
 * 
 * @param {String} uri
 */

SpotifyUri.fromUri = function(uri) {
  return new SpotifyUri(uri);
};

/**
 * SpotifyUri class.
 *
 * @api public
 */

function SpotifyUri(type, id) {
  if ('string' != typeof type) throw new Error('Invalid URI type');

  this._uri_parts = [];

  // TODO(adammw): support playlists in constructor

  if (!id) {
    this.uri = type;
  } else {
    if (id instanceof Buffer) id = SpotifyUri.gid2id(id);
    if (/^[0-9a-f]*$/.test(id)) id = base62.fromHex(id, 22);
    this._uri_parts = ['spotify', type, id];
  }
}

/**
 * SpotifyUri uri getter / setter
 */

Object.defineProperty(SpotifyUri.prototype, 'uri', {
  get: function () {
    var uri = this._uri_parts.join(':');
    debug('get uri() : %s', uri)
    return uri;
  },
  set: function (uri) {
    debug('set uri() : %s', uri);
    var uri_parts = uri.split(':');
    if ('spotify' != uri_parts[0]) throw new Error('Invalid Spotify Uri');
    this._uri_parts = uri_parts;
  },
  enumerable: true,
  configurable: true
});

/**
 * SpotifyUri type getter
 */

Object.defineProperty(SpotifyUri.prototype, 'type', {
  get: function () {
    var parts = this._uri_parts;
    var len = parts.length;

    if (len >= 3 && 'local' == parts[1]) {
      // e.g. spotify:local:AC%2FDC:Highway+to+Hell:Highway+to+Hell:209
      return 'local';
    } else if (len >= 5) {
      // e.g. spotify:user:tootallnate:[playlist]:0Lt5S4hGarhtZmtz7BNTeX
      return parts[3];
    } else if (len >= 4 && 'starred' == parts[3]) {
      // e.g. spotify:user:tootallnate:starred
      return 'playlist';
    } else if (len >= 3) {
      // e.g. spotify:[track]:6tdp8sdXrXlPV6AZZN2PE8
      return parts[1];
    } else {
      return null;
    }
  },
  enumerable: true,
  configurable: true
});

/**
 * SpotifyUri sid getter / setter
 *
 * e.g. '6tdp8sdXrXlPV6AZZN2PE8' for spotify:track:6tdp8sdXrXlPV6AZZN2PE8
 */

Object.defineProperty(SpotifyUri.prototype, 'sid', {
  get: function () {
    var parts = this._uri_parts;
    var len = parts.length;

    return parts[len - 1];
  },
  set: function (sid) {
    var parts = this._uri_parts;
    var len = parts.length;

    parts[len - 1] = sid;
  },
  enumerable: true,
  configurable: true
});

/**
 * SpotifyUri id getter / setter
 *
 * e.g. 'd49fcea60d1f450691669b67af3bda24' for spotify:track:6tdp8sdXrXlPV6AZZN2PE8
 */

Object.defineProperty(SpotifyUri.prototype, 'id', {
  get: function () {
    return base62.toHex(this.sid);
  },
  set: function (id) {
    this.sid = base62.fromHex(id, 22);
  },
  enumerable: true,
  configurable: true
});

/**
 * SpotifyUri gid getter / setter
 *
 * e.g. <Buffer d4 9f ce a6 0d 1f 45 06 91 66 9b 67 af 3b da 24> for spotify:track:6tdp8sdXrXlPV6AZZN2PE8
 */

Object.defineProperty(SpotifyUri.prototype, 'gid', {
  get: function () {
    return new Buffer(this.id, 'hex');
  },
  set: function (gid) {
    this.id = gid.toString('hex');
  },
  enumerable: true,
  configurable: true
});

/**
 * SpotifyUri user getter / setter
 */

Object.defineProperty(SpotifyUri.prototype, 'user', {
  get: function () {
    var parts = this._uri_parts;
    var len = parts.length;

    if (len >= 3 && 'user' == parts[1]) return parts[2];
    return null;
  },
  set: function (user) {
    var parts = this._uri_parts;
    var len = parts.length;

    if (len >= 3 && 'user' == parts[1]) parts[2] = user;
  },
  enumerable: true,
  configurable: true
});

/**
 * Returns the underlying uri string
 *
 * @return {String}
 */
SpotifyUri.prototype.toString = function() {
  return this.uri;
}

/**
 * Converts a GID Buffer to an ID hex string.
 * Provided for backwards compatibility.
 */

SpotifyUri.gid2id = function (gid) {
  return gid.toString('hex');
};

/**
 * ID -> URI
 * Provided for backwards compatibility.
 */

SpotifyUri.id2uri = function (uriType, id) {
  return (new SpotifyUri(uriType, id)).uri;
};

/**
 * URI -> ID
 * Provided for backwards compatibility.
 *
 * >>> SpotifyUtil.uri2id('spotify:track:6tdp8sdXrXlPV6AZZN2PE8')
 * 'd49fcea60d1f450691669b67af3bda24'
 * >>> SpotifyUtil.uri2id('spotify:user:tootallnate:playlist:0Lt5S4hGarhtZmtz7BNTeX')
 * '192803a20370c0995f271891a32da6a3'
 */

SpotifyUri.uri2id = function (uri) {
  return (uri instanceof SpotifyUri) ? uri.id : (new SpotifyUri(uri)).id;
};

/**
 * GID -> URI
 * Provided for backwards compatibility.
 */

SpotifyUri.gid2uri = function (uriType, gid) {
  return (new SpotifyUri(uriType, gid)).uri;
};

/**
 * Accepts a String URI, returns the "type" of URI.
 * i.e. one of "local", "playlist", "track", etc.
 *
 * Provided for backwards compatibility.
 */

SpotifyUri.uriType = function (uri) {
  return (uri instanceof SpotifyUri) ? uri.type : (new SpotifyUri(uri)).type;
};
