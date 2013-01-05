
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

  this.authServer = 'play.spotify.com';
  this.authUrl = '/xhr/json/auth.php';
  this.secretUrl = '/redirect/facebook/notification.php';
  this.userAgent = 'spotify-websocket-api (Chrome/13.37 compatible-ish)';

  // the query-string to send along to the "secret url"
  this.secretPayload = {
    album: 'http://open.spotify.com/album/2mCuMNdJkoyiXFhsQCLLqw',
    song:  'http://open.spotify.com/track/6JEK0CvvjDjjMUBFoXShNZ'
  };

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

  // save credentials for later...
  this.un = un;
  this.pw = pw;

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
  var login = {
    type: 'sp',
    username: this.un,
    password: this.pw,
    secret: secret
  };

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

Spotify.prototype._onmessage = function (msg) {
  debug('WebSocket "message" event: %j', msg);

};
