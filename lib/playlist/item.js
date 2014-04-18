
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
  this.removed = false;

  var spotify = this.playlist._spotify;
  this.item = spotify.get(uri);
}
PlaylistItem['$inject'] = ['Playlist'];

/**
 * Remove the item from it's playlist
 * This method relies on the playlist item's internal index being correct
 *
 * @param {Function} fn callback function
 */
PlaylistItem.prototype.remove = function(fn) {
  if (this.removed) return fn(new Error('PlaylistItem already removed'));

  fn = util.wrapCallback(fn, this.playlist);
  this.playlist._sendOps([{
    kind: "REM",
    rem: {
      fromIndex: this.index,
      length: 1
    }
  }], function(err) {
    this.removed = true;
    fn(err);
  }.bind(this));
};
