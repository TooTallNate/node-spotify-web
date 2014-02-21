
/**
 * Module dependencies.
 */

var Metadata = require('./metadata');
var util = require('../util');
var inherits = require('util').inherits;
var debug = require('debug')('spotify-web:metadata:artist');

/**
 * Module exports.
 */

exports = module.exports = Artist;

/**
 * Creates a new Artist instance with the specified uri, or in the case of multiple uris, 
 * creates an array of new Artist instances.
 *
 * Instances will only contain a URI and will not have metadata populated
 *
 * @param {Object} spotify Spotify object instance
 * @param {Array|String} uris A single URI, or an Array of URIs to get Artist instances for
 * @param {Function} (Optional) fn callback function
 * @return {Array|Artist}
 * @api public
 */

Artist.get = util.bind(Metadata.get, null, Artist);

/**
 * Check whether the class supports construction from a specific schema/object
 *
 * @param {Object} schema
 * @return {Boolean}
 * @api private
 */

Artist._acceptsSchema = util.bind(Metadata._acceptsSchema, null, 'artist');

/**
 * Artist class.
 *
 * @api public
 */

function Artist (spotify, uri, parent) {
  if (!(this instanceof Artist)) return new Artist(spotify, uri, parent);
  this.type = 'artist';
  Metadata.call(this, spotify, uri, parent);
}
inherits(Artist, Metadata);
Artist['$inject'] = ['Spotify'];

Artist.prototype._acceptsSchema = Artist._acceptsSchema;
