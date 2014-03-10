
/**
 * Module exports.
 */

module.exports = PlaylistAttributes;

/**
 * PlaylistAttributes class.
 *
 * @api public
 */

function PlaylistAttributes(playlist) {
  this.playlist = playlist;
  this.revision = null;
}
PlaylistAttributes['$inject'] = ['Playlist'];

/**
 * Parse the response from the Playlist request 
 *
 * @param {SelectedListContent} data
 * @api private
 */
PlaylistAttributes.prototype.parse = function(data) {
  var self = this;
  var PlaylistRevision = this.playlist.PlaylistRevision;
  
  this.revision = new PlaylistRevision(data.revision);

  Object.keys(data.attributes).forEach(function(key) {
    self[key] = data.attributes[key];
  });
};
