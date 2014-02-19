
/**
 * Module dependencies.
 */

var SpotifyConnection = require('./connection');
var Response = require('./response');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var format = require('util').format;
var util = require('../util');
var debug = require('debug')('spotify-web:connection:request');

/**
 * Module exports.
 */

module.exports = Request;

/**
 * Request base class
 *
 * @api public
 *
 * @param {SpotifyConnection} connection
 * @param {String} name
 * @param {Array} (Optional) args Arguments to send with the request
 */

function Request(connection, name, args) {
  debug('Request(%j, %j)', name, args);
  if (!(this instanceof Request)) 
    return new Request(connection, name, args);
  if ('object' != typeof connection || !(connection instanceof SpotifyConnection.constructor))
    throw new Error('SpotifyConnection instance must be supplied as the first argument to the constructor');
  if (name && 'string' != typeof name) 
    throw new Error('Name arguments must be a String');
  EventEmitter.call(this);
  
  this._connection = connection;
  this.name = name || null;
  this.args = args || null;
  this.id = null;
  this.response = null;
  this.sent = false;

  if (this.name && 'connect' != this.name && !/^sp\//.test(this.name)) this.name = 'sp/' + this.name;
}
Request['$inject'] = ['SpotifyConnection'];
inherits(Request, EventEmitter);

/**
 * Return a string representing the Request object
 *
 * @return {String}
 */
Request.prototype.toString = function() {
  return format('<Request id=%j name=%j args=%j>', this.id, this.name, this.args);
};

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
  this.on('callback', util.wrapCallback(fn, this));
  if (undefined !== args) this.args = args;

  // queue the request to be sent
  this.sent = true;
  this._connection.send(this);
};


/**
 * Serialise the request to be sent over the wire
 *
 * @return {String}
 */
Request.prototype.serialize = function() {
  // Generate id if not set
  if (!this.id) this.id = String(this._connection.seq++);

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
  var numCallbackListeners = EventEmitter.listenerCount(this, 'callback');
  var numResponseListeners = EventEmitter.listenerCount(this, 'response');
  var numErrorListeners = EventEmitter.listenerCount(this, 'error');
  
  debug('callback count - "callback": %d, "response": %d, "error": %d', numCallbackListeners, numResponseListeners, numErrorListeners);
  return Boolean(numCallbackListeners || numResponseListeners || numErrorListeners);
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
  this.emit('callback', err, this.response);
};
