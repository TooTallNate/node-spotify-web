
/**
 * Module exports.
 */

module.exports = PlaylistRevision;

/**
 * PlaylistRevision class.
 *
 * @api public
 */

function PlaylistRevision(playlist, revision) {
  this.playlist = playlist;
  this.revision = revision;
}
PlaylistRevision['$inject'] = ['Playlist'];

/**
 * Revision number getter
 */

Object.defineProperty(PlaylistRevision.prototype, 'version', {
  get: function () {
    return this.revision.readUInt32BE(0);
  },
  enumerable: true,
  configurable: true
});

/**
 * Revision sha1 getter
 */

Object.defineProperty(PlaylistRevision.prototype, 'sha1', {
  get: function () {
    return this.revision.slice(4).toString('hex');
  },
  enumerable: true,
  configurable: true
});

/**
 * Returns the string representation of the revision by 
 * concatenating the revision number and hash, separated by a comma
 *
 * @return {String}
 */
PlaylistRevision.prototype.toString = function() {
  return [this.version, this.sha1].join(',');
};
