
/**
 * Module dependencies.
 */

var Metadata = require('./metadata');
var util = require('../util');
var inherits = require('util').inherits;
var debug = require('debug')('spotify-web:metadata:album');

/**
 * Module exports.
 */

exports = module.exports = Album;

/**
 * Creates a new Album instance with the specified uri, or in the case of multiple uris, 
 * creates an array of new Album instances.
 *
 * Instances will only contain a URI and will not have metadata populated
 *
 * @param {Object} spotify Spotify object instance
 * @param {Array|String} uris A single URI, or an Array of URIs to get Album instances for
 * @param {Function} (Optional) fn callback function
 * @return {Array|Album}
 * @api public
 */

Album.get = util.bind(Metadata.get, null, Album);

/**
 * Check whether the class supports construction from a specific schema/object
 *
 * @param {Object} schema
 * @return {Boolean}
 * @api private
 */

Album._acceptsSchema = util.bind(Metadata._acceptsSchema, null, 'album');

/**
 * Album class.
 *
 * @api public
 */

function Album (spotify, uri, parent) {
  if (!(this instanceof Album)) return new Album(spotify, uri, parent);
  this.type = 'album';
  Metadata.call(this, spotify, uri, parent);
}
inherits(Album, Metadata);
Album['$inject'] = ['Spotify'];

Album.prototype._acceptsSchema = Album._acceptsSchema;
