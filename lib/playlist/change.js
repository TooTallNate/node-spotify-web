
/**
 * Module exports.
 */

module.exports = PlaylistChange;

/**
 * PlaylistChange class.
 *
 * @api public
 */

function PlaylistChange(playlist, diff, op) {
  this.playlist = playlist;
  this.kind = op.kind;
  if (this.kind != 'KIND_UNKNOWN') {
    var lowercaseKind = this.kind.toLowerCase();
    this[lowercaseKind] = op[lowercaseKind];
  }

  this.fromRevision = diff.fromRevision;
  this.toRevision = diff.toRevision;
}
PlaylistChange['$inject'] = ['Playlist'];
