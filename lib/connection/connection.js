
/**
 * Module dependencies.
 */

var Spotify = require('../spotify');
var WebSocket = require('ws');
var EventEmitter = require('events').EventEmitter;
var SpotifyError = require('./error');
var Request = require('./request');
var Response = require('./response');
var HermesRequest = require('./hermes_request');
var HermesResponse = require('./hermes_response');
var Subscription = require('./subscription');
var util = require('../util');
var inherits = require('util').inherits;
var debug = require('debug')('spotify-web:connection');

/**
 * Module exports.
 */

module.exports = SpotifyConnection;

/**
 * SpotifyConnection base class
 *
 * @param {Spotify} spotify
 * @api public
 */

function SpotifyConnection(spotify) {
  if (!(this instanceof SpotifyConnection)) 
    return new SpotifyConnection(spotify);

  if ('object' != typeof spotify || !(spotify instanceof Spotify.constructor)) 
    throw new Error('Spotify instance must be supplied as the first argument to the constructor');

  EventEmitter.call(this);
  
  // initalise private instance variables
  this._spotify = spotify;
  this._heartbeatId = null;
  this._callbacks = Object.create(null);
  this._subscriptions = [];
  this._requestQueueFlushId = null;

  // initalise public instance variables
  this.requestQueue = [];
  this.requestQueueFlushHandlers = [];
  this.seq = 0;
  this.heartbeatInterval = 18E4; // 180s, from "spotify.web.client.js"
  this.connected = false; // true after the WebSocket "connect" message is sent
  this.ws = null;

  // start the "heartbeat" once the WebSocket connection is established
  this.once('connect', this._startHeartbeat.bind(this));
  
  // handle events
  this.on('flush', this._onflush.bind(this));
  this.on('open', this._onopen.bind(this));
  this.on('close', this._onclose.bind(this));
  this.on('message', this._onmessage.bind(this));
  this.on('heartbeat', this.sendHeartbeat.bind(this));
  this.on('command', this._onmessagecommand.bind(this));
}
SpotifyConnection['$inject'] = ['Spotify'];
inherits(SpotifyConnection, EventEmitter);

/** 
 * Re-export namespaces
 */

util.export(SpotifyConnection, [Request, Response, HermesRequest, HermesResponse, Subscription]);

/**
 * WebSocket "open" event handler
 *
 * @api private
 */

SpotifyConnection.prototype._onopen = function () {
  debug('WebSocket "open" event');

  if (!this.connected) {
    // need to send "connect" message
    this.sendConnect();
  }
};

/**
 * WebSocket "close" event handler
 *
 * @api private
 */

SpotifyConnection.prototype._onclose = function () {
  debug('WebSocket "close" event');

  if (this.connected) {
    this.disconnect();
  }
};

/**
 * WebSocket "message" event handler.
 *
 * @param {String}
 * @api private
 */

SpotifyConnection.prototype._onmessage = function (data) {
  debug('WebSocket "message" event: %s', data);
  var msg;
  try {
    msg = JSON.parse(data);
  } catch (e) {
    return this.emit('error', e);
  }

  var self = this;
  var id = msg.id;
  var callbacks = this._callbacks;

  function fn (err, res) {
    var cb = callbacks[id];
    if (cb) {
      // got a callback function!
      delete callbacks[id];
      cb.call(self, err, res, msg);
    }
  }

  if ('error' in msg) {
    var err = new SpotifyError(msg.error);
    if (null == id) {
      this.emit('error', err);
    } else {
      fn(err);
    }
  } else if ('message' in msg) {
    var command = msg.message[0];
    var args = msg.message.slice(1);
    this.emit('command', command, args);
  } else if ('id' in msg) {
    fn(null, msg);
  } else {
    // unhandled command
    var err = new Error("Unhandled WebSocket message");
    this.emit('error', err);
    console.error(err, msg);
  }
};

/**
 * "connect" command callback function. 
 *
 * @param {Object} res response Object
 * @api private
 */

SpotifyConnection.prototype._onconnect = function (err, res) {
  debug('SpotifyConnection "connect" event: %s', res);
  if (err) return this.emit('error', err);
  if ('ok' == res.result) {
    debug('connected');

    this.connected = true;
    this.emit('connect');

    // flush the queue if a flush isn't already queued and there are requests in the queue
    if (this.requestQueue.length && !this._requestQueueFlushId) {
      this._requestQueueFlushId = setImmediate(this.emit.bind(this, 'flush'));
    }
  } else {
    // TODO: handle possible error case
    debug('unhandled error case');
  }
};

/**
 * Request Queue Flush callback function.
 *
 * Flushes the request queue by sending out requests
 * 
 * @api private
 */

SpotifyConnection.prototype._onflush = function() {
  if (!this.connected) {
    debug('defering queue flush until connection');
    return;
  }

  debug('request queue flush, %d request(s) before merge', this.requestQueue.length);

  // call request queue flush handlers
  this.requestQueueFlushHandlers.forEach(function(fn) {
    fn.call(this, this.requestQueue);
  });

  // combine multiget requests
  //this.Metadata.mergeMultiGetRequests();

  debug('request queue flush, %d request(s) after merge', this.requestQueue.length);

  // send each pending request in the queue
  while(this.requestQueue.length) {
    this._sendRequest(this.requestQueue.shift());
  }  

  this._requestQueueFlushId = null;
};

/**
 * Handles a "message" command. 
 *
 * @api private
 */

SpotifyConnection.prototype._onmessagecommand = function (command, args) {
  if ('hm_b64' == command) {
    var header = new HermesResponse();
    header.parse(args.slice(1));
    this._subscriptions.forEach(function(subscription) {
      if (util.checkUri(subscription.uri, header.uri)) {
        var response = new HermesResponse(subscription);
        response.parse(args.slice(1));
        subscription.emit('response', response);
      }
    });
  }
};

/**
 * Start the interval that sends and "sp/echo" command to the Spotify server
 * every 180 seconds.
 *
 * @api private
 */

SpotifyConnection.prototype._startHeartbeat = function () {
  debug('starting heartbeat every %s seconds', this.heartbeatInterval / 1000);
  this._heartbeatId = setInterval(this.emit.bind(this, 'heartbeat'), this.heartbeatInterval);
};

/**
 * Stop the heartbeat interval
 */

SpotifyConnection.prototype._stopHeartbeat = function () {
  clearInterval(this._heartbeatId);
  this._heartbeatId = null;
};

/**
 * Actually send a request
 * 
 * This method should only be called as part of flushing the queue
 *
 * @param {Request} request
 * @api private
 */

SpotifyConnection.prototype._sendRequest = function (request) {
  debug('sendRequest(%s)', request);
  var data = request.serialize();

  // store callback function for later
  var callback;
  if (request.hasCallback()) {
    debug('storing callback function for message id %s', request.id);
    callback = this._callbacks[request.id] = request.callback.bind(request);
  } else {
    debug('no callbacks for message id %s', request.id);
    callback = this.emit.bind(this, 'error');
  }

  debug('sending: %s', data);

  try {
    this.ws.send(data);
  } catch (e) {
    callback.call(null, e);
  }
};

/**
 * Connect to the Spotify WebSocket server
 * 
 * @param {String} url WebSocket url
 * @param {Function} fn Callback
 */

SpotifyConnection.prototype.connect = function(url, fn) {
  debug('connect(%j)', url);

  this.ws = new WebSocket(url);

  ['open', 'close', 'message'].forEach(function(event) {
    this.ws.on(event, this.emit.bind(this, event));
  }, this);

  if ('function' == typeof fn) this.on('connect', fn);
};

/**
 * Close the WebSocket connection. 
 *
 * This effectively ends your Spotify Web "session"
 * (and derefs from the event-loop, so your program can exit).
 *
 * @api public
 */

SpotifyConnection.prototype.disconnect = function () {
  debug('disconnect()');
  this.connected = false;
  this._stopHeartbeat();
  if (this.ws) {
    this.ws.close();
    this.ws = null;
  }
  this.emit('disconnect');
};

/**
 * Queue a request to be sent
 *
 * @param {Request} request
 * @api private
 */
SpotifyConnection.prototype.send = function(request) {
  if (!(request instanceof Request)) throw new Error('Request must be a SpotifyConnection.Request instance');
  
  debug('send(%s)', request);
  this.requestQueue.push(request);

  if (!this._requestQueueFlushId)
    this._requestQueueFlushId = setImmediate(this.emit.bind(this, 'flush'));
};

/**
 * Sends the "connect" command. 
 * Should be called once the WebSocket connection is established.
 *
 * @param {Function} fn callback function
 * @api public
 */

SpotifyConnection.prototype.sendConnect = function (fn) {
  debug('sendConnect()');
  var creds = this._spotify.settings.credentials[0].split(':');
  var args = [ creds[0], creds[1], creds.slice(2).join(':') ];
  var request = this.Request('connect', args);
  request.on('callback', this._onconnect.bind(this));

  // we can't use the queue here as the queue waits until we are connected
  this._sendRequest(request);
};

/**
 * Sends an "sp/echo" command.
 *
 * @api private
 */

SpotifyConnection.prototype.sendHeartbeat = function () {
  debug('sendHeartbeat()');
  this.Request('sp/echo').send('h');
};
