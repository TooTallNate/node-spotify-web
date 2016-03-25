
/**
 * Module dependencies.
 * @private
 */

var gid2id = require('./util').gid2id;
var Image = require('./schemas').build('metadata','Image');

/**
 * Module exports.
 * @private
 */

exports = module.exports = Image;

/**
 * Image HTTP link getter.
 * @private
 */

Object.defineProperty(Image.prototype, 'uri', {
  get: function () {
    var spotify = this._spotify;
    var base = spotify.sourceUrls[this.size];
    return base + gid2id(this.fileId);
  },
  enumerable: true,
  configurable: true
});
