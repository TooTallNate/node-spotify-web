
/**
 * Module dependencies.
 */

var Spotify = require('../spotify');
var Response = require('./response');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var debug = require('debug')('spotify-web:request');

/**
 * Module exports.
 */

module.exports = Request;

/**
 * Request base class
 *
 * @api public
 *
 * @param {#Spotify} spotify
 * @param {String} name
 * @param {Array} (Optional) args Arguments to send with the request
 */

function Request(spotify, name, args) {
  debug('Request(%j, %j)', name, args);
  if (!(this instanceof Request)) return new Request(spotify, name, args);
  if ('object' != typeof spotify || !(spotify instanceof Spotify.constructor)) throw new Error('Spotify instance must be supplied as the first argument to the constructor');
  if (name && 'string' != typeof name) throw new Error('Name arguments must be a String');
  EventEmitter.call(this);
  
  this._spotify = spotify;
  this.name = name || null;
  this.args = args || null;
  this.id = null;
  this.response = null;
  this.sent = false;
  this._callback = null;

  if ('connect' != this.name && !/^sp\//.test(this.name)) this.name = 'sp/' + this.name;
}
inherits(Request, EventEmitter);

/**
 * Send the request with the specified payload
 *
 * @param {Array} (Optional) args Arguments to send with the request
 * @param {Function} fn Callback, with signature `function(err, res)` where res is an instance of Response
 */
Request.prototype.send = function(args, fn) { 
  // argument surgery
  if ('function' == typeof args) {
    fn = args;
    args = undefined;
  }

  debug('send(%j)', args); 

  if (this.sent) throw new Error('Request already sent');

  // save the callback and arguments
  this._callback = fn;
  if (undefined !== args) this.args = args;

  // queue the request to be sent
  this.sent = true;
  this._spotify.queueRequest(this);
};


/**
 * Serialise the request to be sent over the wire
 *
 * @return {String}
 */
Request.prototype.serialize = function() {
  // Generate id if not set
  if (!this.id) this.id = String(this._spotify.seq++);

  // Construct and return serialized message
  var msg = {
    name: this.name,
    id: this.id,
    args: this.args
  };

  var data = JSON.stringify(msg);
  debug('serialise() : %s', data);
  return data;
};

/**
 * Return whether or not the request has a callback assigned
 *
 * @return {Boolean}
 */
Request.prototype.hasCallback = function() {
  return ('function' == typeof this._callback);
};

/**
 * Invokes the callback with `err` and `res` and handle arity check.
 *
 * Called when a message comes back with the same ID number as what we sent.
 *
 * @param {Error} err
 * @param {Object} res
 * @api private
 */

Request.prototype.callback = function(err, res){
  debug('callback()');

  // create the response object and parse the result
  if (!err && !this.response) {
    this.response = new Response(this);
    this.response.parse(res);
  }

  // emit response event
  if (this.response) this.emit('response', this.response);

  // invoke callback
  var fn = this._callback;
  if ('function' == typeof fn && 2 == fn.length) return fn(err, this.response);
  if (err) return this.emit('error', err);
  if ('function' == typeof fn) fn(this.response);
};
