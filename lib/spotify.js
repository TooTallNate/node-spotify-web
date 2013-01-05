
/**
 * Module dependencies.
 */

var WebSocket = require('ws');
var cheerio = require('cheerio');
var superagent = require('superagent');
var inherits = require('util').inherits;
var debug = require('debug')('spotify-web');
var EventEmitter = require('events').EventEmitter;

/**
 * Module exports.
 */

module.exports = Spotify;

/**
 * Create instance and login convenience function.
 *
 * @param {String} un username
 * @param {String} pw password
 * @param {Function} fn callback function
 * @api public
 */

Spotify.login = function (un, pw, fn) {
  if (!fn) fn = function () {};
  var spotify = new Spotify();
  spotify.login(un, pw, function (err) {
    if (err) return fn(err);
    fn(null, spotify);
  });
  return spotify;
};

/**
 * Spotify Web base class.
 *
 * @api public
 */

function Spotify () {
  if (!(this instanceof Spotify)) return new Spotify();
  EventEmitter.call(this);

  this.seq = 0;
  this.agent = superagent.agent();
  this.connected = false; // true after the WebSocket "connect" message is sent
  this._callbacks = Object.create(null);

  this.authServer = 'play.spotify.com';
  this.authUrl = '/xhr/json/auth.php';
  this.secretUrl = '/redirect/facebook/notification.php';
  this.userAgent = 'spotify-websocket-api (Chrome/13.37 compatible-ish)';

  // the query-string to send along to the "secret url"
  this.secretPayload = {
    album: 'http://open.spotify.com/album/2mCuMNdJkoyiXFhsQCLLqw',
    song:  'http://open.spotify.com/track/6JEK0CvvjDjjMUBFoXShNZ'
  };

  // WebSocket callbacks
  this._onopen = this._onopen.bind(this);
  this._onclose = this._onclose.bind(this);
  this._onmessage = this._onmessage.bind(this);
}
inherits(Spotify, EventEmitter);

/**
 * Creates the connection to the Spotify Web websocket server and logs in using
 * the given `username` and `password` credentials.
 *
 * @param {String} un username
 * @param {String} pw password
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.login = function (un, pw, fn) {
  debug('Spotify#login(%j, %j)', un, pw);
  var self = this;
  function onLogin () {
    cleanup();
    fn();
  }
  function onError (err) {
    cleanup();
    fn(err);
  }
  function cleanup () {
    self.removeListener('login', onLogin);
    self.removeListener('error', onError);
  }
  if ('function' == typeof fn) {
    this.on('login', onLogin);
    this.on('error', onError);
  }

  // save credentials for later...
  this.creds = { username: un, password: pw };

  var url = 'https://' + this.authServer + this.secretUrl;
  debug('GET %j', url);
  this.agent.get(url)
    .set({ 'User-Agent': this.userAgent })
    .query(this.secretPayload)
    .end(this._onsecret.bind(this));
};

/**
 * Called when the Facebook redirect URL GET (and any necessary redirects) has
 * responded.
 *
 * @api private
 */

Spotify.prototype._onsecret = function (res) {
  debug('secret %d status code, %j content-type', res.statusCode, res.headers['content-type']);
  var $ = cheerio.load(res.text);
  var secret = $('#secret').attr('value');
  debug('login CSRF token %j', secret);

  var login = this.creds;
  delete this.creds;
  login.type = 'sp';
  login.secret = secret;

  // now we have to "auth" in order to get Spotify Web "credentials"
  var url = 'https://' + this.authServer + this.authUrl;
  debug('POST %j', url);
  this.agent.post(url)
    .set({ 'User-Agent': this.userAgent })
    .type('form')
    .send(login)
    .end(this._onauth.bind(this));
};

/**
 * Called upon the "auth" endpoint's HTTP response.
 *
 * @api private
 */

Spotify.prototype._onauth = function (res) {
  debug('auth %d status code, %j content-type', res.statusCode, res.headers['content-type']);
  if (res.ok) {
    this.settings = res.body.config;
    this._openWebsocket();
  } else {
    // TODO: error handling on invalid creds
  }
};

/**
 * Opens the WebSocket connection to the Spotify Web server.
 * Should be called after the _onauth() function.
 *
 * @api private.
 */

Spotify.prototype._openWebsocket = function () {
  var url = this.settings.aps.ws[0];
  debug('WS %j', url);
  this.ws = new WebSocket(url);
  this.ws.on('open', this._onopen);
  this.ws.on('close', this._onclose);
  this.ws.on('message', this._onmessage);
};

/**
 * WebSocket "open" event.
 *
 * @api private
 */

Spotify.prototype._onopen = function () {
  debug('WebSocket "open" event');
  if (!this.connected) {
    // need to send "connect" message
    this.connect();
  }
};

/**
 * WebSocket "close" event.
 *
 * @api private
 */

Spotify.prototype._onclose = function () {
  debug('WebSocket "close" event');
};

/**
 * WebSocket "message" event.
 *
 * @param {String}
 * @api private
 */

Spotify.prototype._onmessage = function (data) {
  debug('WebSocket "message" event: %s', data);
  var msg = JSON.parse(data);
  if ('error' in msg) {

  } else if ('message' in msg) {
    var command = msg.message[0];
    var args = msg.message.slice(1);
    this.emit('message', command, args);
    if ('do_work' == command) {
      debug('got "do_work" payload: %j', args[0]);
      this.sendCommand('sp/work_done', [ 'v1' ], this._onworkdone);
    } else {
      // unhandled "message"
    }
  } else if ('id' in msg) {
    var id = msg.id;
    var fn = this._callbacks[id];
    if (fn) {
      // got a callback function!
      fn.call(this, msg);
      delete this._callbacks[id];
    }
  } else {
    // unhandled command
  }
};

/**
 * Called when the "sp/work_done" command is completed.
 *
 * @api private
 */

Spotify.prototype._onworkdone = function (res) {
  debug('"sp/work_done" ACK');
  console.log('DONE!', res);
};

/**
 * Sends a "message" across the WebSocket connection with the given "name" and
 * optional Array of arguments.
 *
 * @param {String} name command name
 * @param {Array} args optional Array or arguments to send
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.sendCommand = function (name, args, fn) {
  if ('function' == typeof args) {
    fn = args;
    args = [];
  }
  debug('sendCommand(%j, %j)', name, args);
  var msg = {
    name: name,
    id: String(this.seq++),
    args: args || []
  };
  if ('function' == typeof fn) {
    // store callback function for later
    debug('storing callback function for message id %s', msg.id);
    this._callbacks[msg.id] = fn;
  }
  var data = JSON.stringify(msg);
  debug('sending command: %s', data);
  this.ws.send(data);
};

/**
 * Sends the "connect" command. Should be called once the WebSocket connection is
 * established.
 *
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.connect = function (fn) {
  debug('connect()');
  var creds = this.settings.credentials[0].split(':');
  var args = [ creds[0], creds[1], creds.slice(2).join(':') ];
  this.sendCommand('connect', args, this._onconnect.bind(this));
};

/**
 * Gets the "metadata" object for one or more URIs.
 *
 * @param {Array|String} uris A single URI, or an Array of URIs to get "metadata" for
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.metadata = function (uris, fn) {
  debug('metadata(%j)', uris);
  if (!Array.isArray(uris)) {
    uris = [ uris ];
  }
  // array of "request" Objects that will be protobuf'd
  var requests = [];
  uris.forEach(function (uri) {

  });
};

/**
 * "connect" command callback function. If the result was "ok", then get the
 * logged in user's info.
 *
 * @param {Object} res response Object
 * @api private
 */

Spotify.prototype._onconnect = function (res) {
  if ('ok' == res.result) {
    this.connected = true;
    this.sendCommand('sp/user_info', this._onuserinfo.bind(this));
  } else {
    // TODO: handle possible error case
  }
};

/**
 * "sp/user_info" command callback function. Once this is complete, the "login"
 * event is emitted and control is passed back to the user for the first time.
 *
 * @param {Object} res response Object
 * @api private
 */

Spotify.prototype._onuserinfo = function (res) {
  this.username = res.result.user;
  this.country = res.result.country;
  this.accountType = res.result.catalogue;
  this.emit('login');
};
