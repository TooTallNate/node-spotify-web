
/**
 * Module dependencies.
 */

var Spotify = require('../spotify');
var debug = require('debug')('spotify-web:connection:response');

/**
 * Module exports.
 */

module.exports = Response;

/**
 * Response base class
 *
 * @api public
 *
 * @param {Request} request
 */

function Response(request) {
  if (!(this instanceof Response)) return new Response(request);
  
  this.request = request || null;
  this.result = null;
  this.error = null;
}

/**
 * isSuccess getter.
 */

Object.defineProperty(Response.prototype, 'isSuccess', {
  get: function () {
    return (null === this.error);
  },
  enumerable: true,
  configurable: true
});


/**
 * Response parser
 *
 * @param {Array} result
 */
Response.prototype.parse = function(data) {
  debug('parse(%j)', data);
  this.result = data.result || null;
  this.error = data.error || null;
};
