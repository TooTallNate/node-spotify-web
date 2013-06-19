
/**
 * Module dependencies.
 */

var util = require('./util');
var schemas = require('./schemas');
var debug = require('debug')('spotify-web:playlist');

/**
 * Module exports.
 */

var Playlist = exports = module.exports = function(data){
  this._uri = data.uri || null;
  this.revision = data.revision || null;
};

/**
 * Playlist URI getter.
 */

Object.defineProperty(Playlist.prototype, 'uri', {
  get: function () {
    return this._uri;
  },
  enumerable: true,
  configurable: true
});

/**
 * Loads all the metadata for this Playlist instance. Useful for when you get 
 * an only partially filled Playlist instance.
 *
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.get =
Playlist.prototype.metadata = function (fn) {
  // TODO
  throw new Error('not implemented');
};
