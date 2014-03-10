/**
 * Module dependencies.
 */

var SpotifyConnection = require('./connection');
var HermesResponse = require('./hermes_response');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var format = require('util').format;
var debug = require('debug')('spotify-web:connection:subscription');

/**
 * Module exports.
 */

module.exports = Subscription;

/**
 * Subscription base class
 *
 * @api public
 *
 * @param {SpotifyConnection} connection
 */

function Subscription(connection, uri) {
  debug('Subscription(%j)', uri);
  if (!(this instanceof Subscription)) 
    return new Subscription(connection);
  if ('object' != typeof connection || !(connection instanceof SpotifyConnection.constructor))
    throw new Error('SpotifyConnection instance must be supplied as the first argument to the constructor');
  EventEmitter.call(this);
  
  this._connection = connection;
  this._subscription = null;
  this.subscribeHandler = null;
  this.unsubscribeHandler = null;
  this.responseSchema = null;
  this.uri = uri;
}
Subscription['$inject'] = ['SpotifyConnection'];
inherits(Subscription, EventEmitter);

/**
 * Handle subscription
 *
 * @api private
 */
Subscription.prototype._onsubscribed = function(err, response) {
  debug('%s#_onsubscribed() : %j', this, response.result);
  this._subscription = response.result;
  if (this._subscription.uri) this.uri = this._subscription.uri;
};

/**
 * Handle unsubscription
 *
 * @api private
 */
Subscription.prototype._onunsubscribed = function(err) {

};

/**
 * Set the subscribe handler which is used to make the Subscribe requests
 *
 * @param {Function} fn Function with signature `function(fn)` where fn is a callback with signature `function(err, subscription)` where subscription is the returned subscription
 */
Subscription.prototype.setSubscribeHandler = function(fn) {
  this.subscribeHandler = fn;
};

/**
 * Set the unsubscribe handler which is used to make the Unsubscribe requests
 *
 * @param {Function} fn Function with signature `function(fn)` where fn is a callback with signature `function(err)`
 */
Subscription.prototype.setUnsubscribeHandler = function(fn) {
  this.unsubscribeHandler = fn;
};

/**
 * Sets the schema to be used to parse the response payload when recieving the payload
 *
 * @param {Schema} schema 
 */
Subscription.prototype.setResponseSchema = function(schema) {
  debug('setResponseSchema()');

  // TODO(adammw): check that schema is a valid schema
  this.responseSchema = schema;
};

/**
 * Returns if the subscription is subscribed
 *
 * @return {Boolean}
 */
Subscription.prototype.subscribed = function() {
  return (-1 !== this._connection._subscriptions.indexOf(this));
};

/**
 * Add the subscription to the connection's list of active subscriptions
 * and call the subscribe handler if it's the first active subscription for this uri
 */
Subscription.prototype.subscribe = function() {
  debug('%s#subscribe()', this);
  if (!this.subscribeHandler) throw new Error("Subscribe Handler not set");
  var subscriptions = this._connection._subscriptions;
  if (-1 !== subscriptions.indexOf(this)) {
    debug('already subscribed - ignoring subscribe()');
    return;
  }
  subscriptions.push(this);
  debug('added subscription');
  for (var i = 0, l = subscriptions.length; i < l; i++) {
    var subscription = subscriptions[i];
    if (subscription != this && subscription.uri == this.uri) return;
  }
  debug('we are the only subscription for this url, calling subscribeHandler');
  this.subscribeHandler(this._onsubscribed.bind(this));
};

/**
 * Remove the subscription to the connection's list of active subscriptions
 * and call the unsubscribe handler if it's the last active subscription for this uri
 */
Subscription.prototype.unsubscribe = function() {
  debug('%s#unsubscribe()', this);
  if (!this.unsubscribeHandler) throw new Error("Unsubscribe Handler not set");
  var subscriptions = this._connection._subscriptions;
  var idx;
  if (-1 === (idx = subscriptions.indexOf(this))) {
    debug('not subscribed - ignoring unsubscribe()');
    return;
  }
  debug('removing subscription');
  subscriptions.splice(idx, 1);
  for (var i = 0, l = subscriptions.length; i < l; i++) {
    if (subscriptions[i].uri == this.uri) return;
  }
  debug('we are the last subscription for this url, calling unsubscribeHandler');
  this.unsubscribeHandler(this._onunsubscribed.bind(this));
};

Subscription.prototype.toString = function() {
  return format('<Subscription uri=%j>', this.uri);
};
