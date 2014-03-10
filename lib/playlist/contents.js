
/**
 * Module dependencies.
 */

var inherits = require('util').inherits;

/**
 * Module exports.
 */

module.exports = PlaylistContents;

/**
 * PlaylistContents class.
 *
 * @api public
 */

function PlaylistContents(playlist) {
  this.playlist = playlist;
  this.revision = null;
  this.offset = null;
  this.truncated = null;
}
inherits(PlaylistContents, Array);
PlaylistContents['$inject'] = ['Playlist'];

/**
 * Parse the response from the Playlist contents request 
 *
 * @param {SelectedListContent} data
 * @api private
 */
PlaylistContents.prototype.parse = function(data) {
  var contents = this;
  var PlaylistItem = this.playlist.PlaylistItem;
  var PlaylistRevision = this.playlist.PlaylistRevision;

  // copy over some data
  this.revision = new PlaylistRevision(data.revision);
  this.offset = data.contents.pos;
  this.truncated = data.contents.truncated;

  // convert items into PlaylistItem objects and add to our internal array
  if (data.contents.items && data.contents.items.length) {
    data.contents.items.forEach(function(item) {
      contents.push(new PlaylistItem(item.uri, item.attributes));
    });
  }
};
