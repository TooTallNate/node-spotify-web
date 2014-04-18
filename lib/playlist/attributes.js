
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
 * List of valid attributes
 * Extracted from playlist4meta.proto
 */
PlaylistAttributes.VALID_ATTRIBUTES = ['name', 'description', 'picture', 'collaborative', 
                                       'pl3_version', 'deleted_by_owner', 'restricted_collaborative'];

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

/**
 * Save modifications to the PlaylistAttributes back to the server
 *
 * @param {Function} fn callback function
 * @api private
 */
PlaylistAttributes.prototype.save = function(fn) {
  var attributes = {};
  Object.keys(this).filter(function(key) {
    return PlaylistAttributes.VALID_ATTRIBUTES.indexOf(key) !== -1;
  }).forEach(function(key) {
   attributes[key] = this[key];
  }, this);
  this.playlist.updateAttributes(attributes, fn);
};
