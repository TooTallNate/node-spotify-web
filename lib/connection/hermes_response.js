
/**
 * Module dependencies.
 */

var Spotify = require('../spotify');
var schemas = require('../schemas');
var http = require('http');
var debug = require('debug')('spotify-web:connection:response:hermes');

/**
 * Module exports.
 */

module.exports = HermesResponse;

/**
 * Protocol Buffer types.
 */

var MercuryRequest = schemas.build('mercury','MercuryRequest');
var MercuryReply = schemas.build('mercury','MercuryReply');

/**
 * HermesResponse base class
 *
 * @api public
 *
 * @param {HermesRequest} request
 */

function HermesResponse(request) {
  if (!(this instanceof HermesResponse)) return new HermesResponse(request);
  
  this._statusMessage = null;

  this.request = request || null;
  this.uri = null;
  this.contentType = null;
  this.statusCode = null;
  this.cachePolicy = null;
  this.ttl = null;
  this.etag = null;
  this.userFields = Object.create(null);
  this.result = null;
}

/**
 * isSuccess getter.
 */

Object.defineProperty(HermesResponse.prototype, 'isSuccess', {
  get: function () {
    return (200 == this.statusCode);
  },
  enumerable: true,
  configurable: true
});

/**
 * isRedirect getter.
 */

Object.defineProperty(HermesResponse.prototype, 'isRedirect', {
  get: function () {
    return (this.statusCode >= 300 && this.statusCode < 400);
  },
  enumerable: true,
  configurable: true
});

/**
 * isClientError getter.
 */

Object.defineProperty(HermesResponse.prototype, 'isClientError', {
  get: function () {
    return (this.statusCode >= 400 && this.statusCode < 500);
  },
  enumerable: true,
  configurable: true
});

/**
 * isServerError getter.
 */

Object.defineProperty(HermesResponse.prototype, 'isServerError', {
  get: function () {
    return (this.statusCode >= 500 && this.statusCode < 600);
  },
  enumerable: true,
  configurable: true
});

/**
 * statusMessage getter.
 */
Object.defineProperty(HermesResponse.prototype, 'statusMessage', {
  get: function () {
    if (this._statusMessage) return this._statusMessage;
    return http.STATUS_CODES[this.statusCode] || 'Unknown Status Code';
  },
  enumerable: true,
  configurable: true
});

/**
 * HermesResponse parser
 *
 * @param {Array} data
 */
HermesResponse.prototype.parse = function(data) {
  debug('parse(%j)', data);
  var self = this;

  // special case where the callback is invoked from parent multi-get request
  if (data instanceof MercuryReply) {
    this.uri = this.request.uri;
    this.contentType = data.contentType.toString();
    this.statusCode = data.statusCode;
    this._statusMessage = data.statusMessage;
    this.cachePolicy = data.cachePolicy.replace('CACHE_','').toLowerCase();
    this.ttl = data.ttl;
    this.etag = data.etag;
    this.result = data.body;
  
  // general case
  } else {
    if (data.result) {
      data = data.result;
    }

    var header = MercuryRequest.parse(new Buffer(data[0], 'base64'));
    
    this.uri = header.uri;
    this.contentType = header.contentType;
    this.statusCode = header.statusCode;

    if (header.userFields) {
      if ('MC-Cache-Policy' in header.userFields)
        this.cachePolicy = header.userFields['MC-Cache-Policy'].toString();
      if ('MC-ETag' in header.userFields)
        this.etag = header.userFields['MC-ETag'];
      if ('MC-TTL' in header.userFields)
        this.ttl = Number(header.userFields['MC-TTL'].toString());

      header.userFields.forEach(function(field) {
        self.userFields[field.name] = field.value;
      });
    }

    if (data.length > 1)
      this.result = new Buffer(data[1], 'base64');
  }  

  if (this.result && this.request && this.request.responseSchema)
    this.result = this.request.responseSchema.parse(this.result);

  debug('%s response [%d / %s] - %j', this.uri, this.statusCode, this.contentType, this.result);
};
