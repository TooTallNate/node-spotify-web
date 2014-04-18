
/**
 * Module exports.
 */

module.exports = PlaylistItem;

/**
 * PlaylistItem class.
 *
 * @api public
 */

function PlaylistItem(playlist, uri, attributes) {
  if (!(this instanceof PlaylistItem)) return new PlaylistItem(playlist, uri, attributes);
  
  this.playlist = playlist;
  this.attributes = attributes || {};

  this.index = null;
  this.revision = null;

  var spotify = this.playlist._spotify;
  this.item = spotify.get(uri);
}
PlaylistItem['$inject'] = ['Playlist'];
