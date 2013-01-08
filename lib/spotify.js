
/**
 * Module dependencies.
 */

var fs = require('fs');
var vm = require('vm');
var path = require('path');
var util = require('./util');
var WebSocket = require('ws');
var cheerio = require('cheerio');
var protobuf = require('protobuf');
var superagent = require('superagent');
var inherits = require('util').inherits;
var debug = require('debug')('spotify-web');
var EventEmitter = require('events').EventEmitter;

/**
 * Module exports.
 */

module.exports = Spotify;

/**
 * Protocol Buffer schemas.
 */

var mercury = new protobuf.Schema(fs.readFileSync(path.resolve(__dirname, '..', 'proto', 'mercury.desc')));
var MercuryMultiGetRequest = mercury['spotify.mercury.proto.MercuryMultiGetRequest'];
var MercuryMultiGetReply = mercury['spotify.mercury.proto.MercuryMultiGetReply'];
var MercuryRequest = mercury['spotify.mercury.proto.MercuryRequest'];
var MercuryReply = mercury['spotify.mercury.proto.MercuryReply'];

var metadata = new protobuf.Schema(fs.readFileSync(path.resolve(__dirname, '..', 'proto', 'metadata.desc')));
var Artist = metadata['spotify.metadata.proto.Artist'];
var Album = metadata['spotify.metadata.proto.Album'];
var Track = metadata['spotify.metadata.proto.Track'];

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
    fn.call(spotify, null, spotify);
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
  this.heartbeatInterval = 18E4; // 180s, from "spotify.web.client.js"
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

  // base URLs for Image files like album artwork, artist prfiles, etc.
  // these values taken from "spotify.web.client.js"
  this.sourceUrl = 'https://d3rt1990lpmkn.cloudfront.net';
  this.sourceUrls = {
    tiny:   this.sourceUrl + '/60/',
    normal: this.sourceUrl + '/300/',
    small:  this.sourceUrl + '/120/',
    large:  this.sourceUrl + '/640/',
    avatar: this.sourceUrl + '/artist_image/'
  };

  // WebSocket callbacks
  this._onopen = this._onopen.bind(this);
  this._onclose = this._onclose.bind(this);
  this._onmessage = this._onmessage.bind(this);

  // start the "heartbeat" once the WebSocket connection is established
  this.once('connect', this._startHeartbeat);

  // handle "message" commands...
  this.on('message', this._onmessagecommand);

  // needs to emulate Spotify's "CodeValidator" object
  this._context = vm.createContext();
  this._context.reply = this._reply.bind(this);
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
  if ('ERROR' == res.body.status) {
    // got an error...
    var err = res.body.error;
    if (res.body.message) err += ': ' + res.body.message;
    this.emit('error', new Error(err));
  } else {
    this.settings = res.body.config;
    this._openWebsocket();
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
    console.error(msg);
    throw new Error('TODO: implement!');
  } else if ('message' in msg) {
    var command = msg.message[0];
    var args = msg.message.slice(1);
    this.emit('message', command, args);
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
 * Handles a "message" command. Specifically, handles the "do_work" command and
 * executes the specified JavaScript in the VM.
 */

Spotify.prototype._onmessagecommand = function (command, args) {
  if ('do_work' != command) return;
  debug('got "do_work" payload: %j', args[0]);
  try {
    vm.runInContext(args[0], this._context);
  } catch (e) {
    this.emit('error', e);
  }
};

/**
 * Called when the "sp/work_done" command is completed.
 *
 * @api private
 */

Spotify.prototype._onworkdone = function (res) {
  debug('"sp/work_done" ACK');
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
 * Closes the WebSocket connection of present. This effectively ends your Spotify
 * Web "session" (and derefs from the event-loop, so your program can exit).
 *
 * @api public
 */

Spotify.prototype.disconnect = function () {
  this.connected = false;
  clearInterval(this._heartbeatId);
  if (this.ws) {
    this.ws.close();
    this.ws = null;
  }
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
    var type = util.uriType(uri);
    if ('local' == type) {
      debug('ignoring "local" track URI: %j', uri);
      return;
    }
    var id = util.uri2id(uri);
    requests.push({
      body: 'GET',
      uri: 'hm://metadata/' + type + '/' + id
    });
  });
  var data;
  var args = [ 0 ];
  if (requests.length == 1) {
    data = MercuryRequest.serialize(requests[0]).toString('base64');
    args.push(data);
  } else {
    throw new Error('implement!');
  }

  this.sendCommand('sp/hm_b64', args, function (res) {
    var ret;
    var data = res.result;
    var header = MercuryReply.parse(new Buffer(data[0], 'base64'));
    if ('vnd.spotify/mercury-mget-reply' == header.statusMessage) {
      // multi-get request
      throw new Error('implement!');
    } else {
      // single entry response
      ret = parseItem(header.statusMessage, data[1]);
    }
    fn(null, ret);
  });

  function parseItem (type, body) {
    var parser;
    if ('vnd.spotify/metadata-artist' == type) {
      parser = Artist;
    } else if ('vnd.spotify/metadata-album' == type) {
      parser = Album;
    } else if ('vnd.spotify/metadata-track' == type) {
      parser = Track;
    } else {
      throw new Error('Unrecognised metadata type: ' + type);
    }
    return parser.parse(new Buffer(body, 'base64'));
  }
};

/**
 * Gets the MP3 160k audio URL for the given "track" metadata object.
 *
 * @param {Object} track Track "metadata" instance
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.trackUri = function (track, fn) {
  debug('trackUri()');
  // TODO: recurse alternatives here
  // TODO: make "format" configurable here
  var args = [ 'mp3160', util.gid2id(track.gid) ];
  debug('sp/track_uri args: %j', args);
  this.sendCommand('sp/track_uri', args, function (res) {
    fn(null, res.result);
  });
};

/**
 * Checks if the given track "metadata" object is "available" for playback, taking
 * account for the allowed/forbidden countries, the user's current country, the
 * user's account type (free/paid), etc.
 *
 * @param {Object} track Track "metadata" instance
 * @return {Boolean} true if track is playable, false otherwise
 * @api public
 */

Spotify.prototype.isTrackAvailable = function (track) {
  debug('isTrackAvailable()');

};

/**
 * Checks if the given "track" is "available". If yes, returns the "track"
 * untouched. If no, then the "alternative" tracks array on the "track" instance
 * is searched until one of them is "available", and then returns that "track".
 * If none of the alternative tracks are "available", returns `null`.
 *
 * @param {Object} track Track "metadata" instance
 * @return {Object} "available" Track "metadata" instance, or `null`
 * @api public
 */

Spotify.prototype.recurseAlternatives = function (track, fn) {
  debug('recurseAlternatives()');

};

/**
 * Executes a "search" against the Spotify music library. Note that the response
 * is an XML data String, so you must parse it yourself.
 *
 * @param {String|Object} opts string search term, or options object with search
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.search = function (opts, fn) {
  if ('string' == typeof opts) {
    opts = { query: opts };
  }
  if (null == opts.maxResults || opts.maxResults > 50) {
    opts.maxResults = 50;
  }
  if (null == opts.type) {
    opts.type = 'all';
  }
  if (null == opts.offset) {
    opts.offset = 0;
  }
  if (null == opts.query) {
    throw new Error('must pass a "query" option!');
  }

  var types = {
    tracks: 1,
    albums: 2,
    artists: 4,
    playlists: 8
  };
  var type;
  if ('all' == opts.type) {
    type = types.tracks | types.albums | types.artists | types.playlists;
  } else if (Array.isArray(opts.type)) {
    type = 0;
    opts.type.forEach(function (t) {
      if (!(t in types)) {
        throw new Error('unknown search "type": ' + opts.type);
      }
      type |= types[t];
    });
  } else if (opts.type in types) {
    type = types[opts.type];
  } else {
    throw new Error('unknown search "type": ' + opts.type);
  }

  var args = [ opts.query, type, opts.maxResults, opts.offset ];
  this.sendCommand('sp/search', args, function (res) {
    // XML-parsing is left up to the user, since they may want to use libxmljs,
    // or node-sax, or node-xml2js, or whatever. So leave it up to them...
    fn(null, res.result);
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
    this.emit('connect');
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

/**
 * Starts the interval that sends and "sp/echo" command to the Spotify server
 * every 18 seconds.
 *
 * @api private
 */

Spotify.prototype._startHeartbeat = function () {
  debug('starting heartbeat every %s seconds', this.heartbeatInterval / 1000);
  var fn = this._onheartbeat.bind(this);
  this._heartbeatId = setInterval(fn, this.heartbeatInterval);
};

/**
 * Sends an "sp/echo" command.
 *
 * @api private
 */

Spotify.prototype._onheartbeat = function () {
  this.sendCommand('sp/echo', 'h');
};

/**
 * Called when `this.reply()` is called in the "do_work" payload.
 *
 * @api private
 */

Spotify.prototype._reply = function () {
  var args = Array.prototype.slice.call(arguments);
  debug('reply(%j)', args);
  this.sendCommand('sp/work_done', args, this._onworkdone);
};
