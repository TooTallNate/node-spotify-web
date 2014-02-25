
/**
 * Module dependencies.
 */

var Request = require('./request');
var HermesResponse = require('./hermes_response');
var schemas = require('../schemas');
var http = require('http');
var inherits = require('util').inherits;
var format = require('util').format;
var debug = require('debug')('spotify-web:connection:request:hermes');

/**
 * Module exports.
 */

module.exports = HermesRequest;

/**
 * Constants
 */

const hermesRequestName = 'sp/hm_b64';
const multiGetRequestType = 'vnd.spotify/mercury-mget-request';
const multiGetResponseType = 'vnd.spotify/mercury-mget-reply';

/**
 * Protocol Buffer types.
 */

var MercuryRequest = schemas.build('mercury','MercuryRequest');
var MercuryMultiGetRequest = schemas.build('mercury','MercuryMultiGetRequest');
var MercuryMultiGetReply = schemas.build('mercury','MercuryMultiGetReply');

/**
 * HermesRequest class constructor.
 *
 * @param {SpotifyConnection} connection The SpotifyConnection instance
 * @param {String} (Optional) method The request method
 * @param {Object|String} args The request arguments, or the Hermes URI
 */

function HermesRequest(connection, method, args) {
  Request.call(this, connection, hermesRequestName, null);

  // argument surgery 
  if ('string' == typeof args) {
    args = { uri: args }; 
  }
  if ('string' == typeof method) {
    if (!args) args = { uri: method };
    else args.method = method;
  } else if (method && !args) {
    args = method;
  }
  args = args || {};

  debug('HermesRequest(%j)', args);
  
  this.subrequests = [];
  this.response = null;

  this.uri = args.uri || '';
  this.method = args.method || 'GET';
  this.source = args.source || '';
  this.contentType = args.contentType || '';
  this.requestSchema = args.requestSchema || args.payloadSchema || null; // payloadSchema for backwards compat
  this.responseSchema = args.responseSchema || null;
  this.payload = args.payload || null;

  // TODO(adammw): support user fields
}
HermesRequest['$inject'] = ['SpotifyConnection'];
inherits(HermesRequest, Request);

/**
 * Return the method ID number used in the arguments
 *
 * @api private
 */
HermesRequest.prototype._methodId = function() {
  switch(this.method) {
    case "SUB":
      return 1;
    case "UNSUB":
      return 2;
    default:
      return 0;
  }
};

/**
 * Add a subrequest to the request instance to perform a "multi-get" request
 *
 * @param {HermesRequest|Object} request The subrequest to add to the parent request instance
 */
HermesRequest.prototype.addSubrequest = function(request) {
  debug('addSubrequest()');
  if (!(request instanceof HermesRequest)) request = new HermesRequest(this._spotify, request);
  if (request.hasSubrequests()) throw new Error('Cannot add a request with subrequests to another request');
  this.subrequests.push(request);
};

/**
 * Add multiple subrequests to the request instance to perform a "multi-get" request
 *
 * @param {Array} requests An array of subrequests
 */
HermesRequest.prototype.addSubrequests = function(requests) {
  debug('addSubrequests() : %d requests', requests.length);
  if (!Array.isArray(requests)) throw new Error('Argument must be an array');
  requests.forEach(this.addSubrequest.bind(this));
};

/**
 * Returns whether or not the request instance has any subrequests added to it
 * 
 * @return {Boolean}
 */
HermesRequest.prototype.hasSubrequests = function() {
  debug('hasSubrequests()');
  return Boolean(this.subrequests.length);
};

/**
 * Return whether or not the request or any subrequests have a callback assigned
 *
 * @return {Boolean}
 */
HermesRequest.prototype.hasCallback = function() {
  debug('hasCallback()');
  if (this.hasSubrequests()) {
    for (var i = 0, l = this.subrequests.length; i < l; i++) {
      if (this.subrequests[i].hasCallback()) return true;
    }
  }
  return Request.prototype.hasCallback.call(this);
};


/**
 * Sets the schema to be used to serialise the payload when sending the request
 *
 * @param {Schema} schema 
 */
HermesRequest.prototype.setRequestSchema = function(schema) {
  debug('setRequestSchema()');

  // TODO(adammw): check that schema is a valid schema
  this.requestSchema = schema;
};

/**
 * Sets the schema to be used to parse the response payload when recieving the payload
 *
 * @param {Schema} schema
 */
HermesRequest.prototype.setResponseSchema = function(schema) {
  debug('setResponseSchema()');

  // TODO(adammw): check that schema is a valid schema
  this.responseSchema = schema;
};

/**
 * Send the request with the specified payload
 *
 * @param {Object} (Optional) data Data payload to send with the request
 * @param {Function} fn Callback, with signature `function(err, res)` where res is an instance of HermesResponse
 */
HermesRequest.prototype.send = function(data, fn) {
  // argument surgery
  if ('function' == typeof data) {
    fn = data;
    data = null;
  }

  debug('send(%j)', data);
  if (this.sent) throw new Error('Request already sent');

  // save the data payload
  this.payload = data;

  // defer to Request class
  // (we cheat a little by setting arguments to null, and overriding them at serialization time)
  return Request.prototype.send.call(this, null, fn);
};

/**
 * Serialise the request to be sent over the wire
 *
 * @return {String}
 */
HermesRequest.prototype.serialize = function() {
  debug('serialize()');

  if (this.hasSubrequests()) {
    this.contentType = multiGetRequestType;
    this.method = 'GET';
    this.requestSchema = MercuryMultiGetRequest;
    this.responseSchema = MercuryMultiGetReply;
    this.payload = { request: this.subrequests };
  }

  // serialise header
  var header = MercuryRequest.serialize(this).toString('base64');

  // construct arguments for request
  this.args = [ this._methodId(), header ];

  // serialize payload
  if (this.payload) {
    var data = this.payload;
    if (this.requestSchema) data = this.requestSchema.serialize(data).toString('base64');
    this.args.push(data);
  }
  
  // defer to Request class
  return Request.prototype.serialize.call(this);
};

/**
 * Invoke the callback and any callbacks of the subrequests.
 *
 * @param {Error} err
 * @param {Response} res
 * @api private
 */

HermesRequest.prototype.callback = function(err, res){
  debug('callback()');

  if (err && !this.hasCallback()) {
    debug('no callback - emitting error event');
    return this.emit('error', err);
  }

  if (!err) {
    this.response = new HermesResponse(this); 
    this.response.parse(res);

    // make unsuccessful responses an error
    if (!this.response.isSuccess) {
      var type = '';
      if (this.response.isClientError) type = 'Client ';
      if (this.response.isServerError) type = 'Server ';
      if (this.response.isRedirect) type = 'Redirect ';
      err = new Error(format('%sError: %s (%d)', type, this.response.statusMessage, this.response.statusCode));
    }

    // call the callbacks of each subrequest
    if (this.hasSubrequests()) {
      debug('calling %d subrequest callbacks', this.subrequests.length);

      if (multiGetResponseType != this.response.contentType)
        err = new Error('Server Error: Server didn\'t send a multi-GET reply for a multi-GET request!');

      if (err) { // with an error...
        this.subrequests.forEach(function(req) {
          req.callback(err);
        });
      } else { // or with their response data...
        var replies = this.response.result.reply;
        if (replies.length != this.subrequests.length)
          debug("warn: number of replies does not match number of requests");
        for (var i = 0, l = Math.min(replies.length, this.subrequests.length); i < l; i++) {
          this.subrequests[i].callback(null, replies[i]);
        }
      }
    }
  }

  Request.prototype.callback.call(this, err, null);
};

/**
 * Return a string representing the Request object
 *
 * @return {String}
 */
HermesRequest.prototype.toString = function() {
  return format('<HermesRequest id=%j method=%j uri=%j payload=%j>', this.id, this.method, this.uri, this.payload);
};
