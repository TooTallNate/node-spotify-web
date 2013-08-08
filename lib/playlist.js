
/**
 * Module dependencies.
 */

var util = require('./util');
var inherits = require('util').inherits;
var SelectedListContent = require('./schemas').playlist4changes['spotify.playlist4.proto.SelectedListContent'];
var debug = require('debug')('spotify-web:playlist');

/**
 * Module exports.
 */

var Playlist = exports = module.exports = function(data){
  debug('Playlist(%j)',data)

  if (!(this instanceof Playlist)) return new Playlist(data);
  SelectedListContent.call(this);

  if ('object' != typeof data) return;
  var self = this;
  Object.keys(data).forEach(function(key){
    Object.defineProperty(self, key, {
      value: data[key],
      enumerable: true,
      writable: false,
      configurable: true
    });
  });

  // TODO: coerce this.contents.items to Track objects
};
inherits(Playlist, SelectedListContent);

/**
 * Wrap the SelectedListContent parse
 */
Playlist.parse = function(data) {
  return new Playlist(SelectedListContent.parse(data));
};

/**
 * Wrap the SelectedListContent serialize
 */
Playlist.serialize = function(data) {
  return SelectedListContent.serialize(data);
};

/**
 * Loads all the metadata for this Playlist instance. Useful for when you get 
 * an only partially filled Playlist instance.
 *
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.get =
Playlist.prototype.metadata = function (fn) {
  // TODO: implement caching in a modification-friendly way

  var spotify = this._spotify;
  var self = this;
  spotify.playlist(this.uri, function (err, playlist) {
    if (err) return fn(err);
    // extend this Playlist instance with the new one's properties
    Object.keys(playlist).forEach(function (key) {
      Object.defineProperty(self, key, {
        value: playlist[key],
        enumerable: true,
        writable: false,
        configurable: true
      });
    });
    fn(null, self);
  });
};
