
/**
 * Module dependencies.
 */

var gid2id = require('./util').gid2id;
var metdadata = require('./schemas').metadata.build('spotify.metdadata.proto');
var Image = metdadata.Image;

/**
 * Module exports.
 */

exports = module.exports = Image;

/**
 * Image HTTP link getter.
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
