
/**
 * Module dependencies.
 */

var vm = require('vm');
var util = require('./util');
var cheerio = require('cheerio');
var schemas = require('./schemas');
var superagent = require('superagent');
var inherits = require('util').inherits;
var SpotifyConnection = require('./connection');
var SpotifyUri = require('./uri');
var Metadata = require('./metadata');
var Playlist = require('./playlist');
var User = require('./user');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('spotify-web');
var pkg = require('../package.json');

/**
 * Module exports.
 */

module.exports = Spotify;

/**
 * Protocol Buffer types.
 */

var MercuryMultiGetRequest = schemas.build('mercury','MercuryMultiGetRequest');
var MercuryMultiGetReply = schemas.build('mercury','MercuryMultiGetReply');
var MercuryRequest = schemas.build('mercury','MercuryRequest');

var Image = require('./image');
require('./restriction');

var SelectedListContent = schemas.build('playlist4','SelectedListContent');

var StoryRequest = schemas.build('bartender','StoryRequest');
var StoryList = schemas.build('bartender','StoryList');

/**
 * Re-export all the `SpotifyUri` functions.
 */

['gid2id', 'id2uri', 'uri2id', 'gid2uri', 'uriType'].forEach(function(key) {
  Spotify[key] = SpotifyUri[key];
});

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

  this.agent = superagent.agent();
  this.connection = new this.SpotifyConnection;

  this.authServer = 'play.spotify.com';
  this.authUrl = '/xhr/json/auth.php';
  this.landingUrl = '/';
  this.userAgent = 'Mozilla/5.0 (Chrome/13.37 compatible-ish) spotify-web/' + pkg.version;

  // base URLs for Image files like album artwork, artist prfiles, etc.
  // these values taken from "spotify.web.client.js"
  this.sourceUrl = 'https://d3rt1990lpmkn.cloudfront.net';
  this.sourceUrls = {
    tiny:   this.sourceUrl + '/60/',
    small:  this.sourceUrl + '/120/',
    normal: this.sourceUrl + '/300/',
    large:  this.sourceUrl + '/640/',
    avatar: this.sourceUrl + '/artist_image/'
  };

  // mappings for the protobuf `enum Size`
  this.sourceUrls.DEFAULT = this.sourceUrls.normal;
  this.sourceUrls.SMALL = this.sourceUrls.tiny;
  this.sourceUrls.LARGE = this.sourceUrls.large;
  this.sourceUrls.XLARGE = this.sourceUrls.avatar;

  // handle "message" commands...
  this.connection.on('command', this._onmessagecommand.bind(this));

  // handle Multi-Get automatically
  this.connection.requestQueueFlushHandlers.push(this.Metadata.mergeMultiGetRequests);

  // needs to emulate Spotify's "CodeValidator" object
  this._context = vm.createContext();
  this._context.reply = this._reply.bind(this);

  // binded callback for when user doesn't pass a callback function
  this._defaultCallback = this._defaultCallback.bind(this);
}
inherits(Spotify, EventEmitter);
Spotify.$provides = {'SpotifyConnection': 'connection'};

/**
 * Re-export all sub-classes
 */

[SpotifyConnection, SpotifyUri, Metadata, Playlist, User].forEach(util.recursiveExport, Spotify);

/**
 * User info getters
 */

Object.defineProperty(Spotify.prototype, 'username', {
  get: function() { 
    return this.user_info.user;
  },
  enumerable: true,
  configurable: true
});

Object.defineProperty(Spotify.prototype, 'country', {
  get: function() { 
    return this.user_info.country;
  },
  enumerable: true,
  configurable: true
});

Object.defineProperty(Spotify.prototype, 'catalogue', {
  get: function() { 
    return this.user_info.catalogue;
  },
  enumerable: true,
  configurable: true
});

/**
 * Convert Schemas to objects
 *
 * @param {Object} obj
 * @param {Object} (Optional) parent
 * @return {Object}
 * @api private 
 */
Spotify.prototype._objectify = function(obj, parent) {
  if ('object' != typeof obj) return obj;

  // TODO(adammw): convert bare uris to SpotifyUri types 
  // (may not be needed if everything has it's own class that does that)
  
  var exports = Spotify['$exports'];

  for (var i = 0, il = exports.length; i < il; i++) {
    var type = this[exports[i]];
    
    // skip if it is already a type
    if (obj instanceof type) return obj;

    // check if the object is an instance of any of the types accepted schemas
    if (type._acceptsSchema && type._acceptsSchema(obj)) {
      debug('objectifying object: %j', obj);
      return new type(obj, parent);
    }
  }

  // otherwise, recurse the object
  var self = this;
  Object.keys(obj).forEach(function(key) {
    obj[key] = self._objectify(obj[key], parent);
  });
  return obj;
};

/**
 * Creates the connection to the Spotify Web websocket server and logs in using
 * the given Spotify `username` and `password` credentials.
 *
 * @param {String} un username
 * @param {String} pw password
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.login = function (un, pw, fn) {
  debug('Spotify#login(%j, %j)', un, pw.replace(/./g, '*'));

  // save credentials for later...
  this.creds = { username: un, password: pw, type: 'sp' };

  this._setLoginCallbacks(fn);
  this._makeLandingPageRequest();
};

/**
 * Creates the connection to the Spotify Web websocket server and logs in using
 * an anonymous identity.
 *
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.anonymousLogin = function (fn) {
  debug('Spotify#anonymousLogin()');

  // save credentials for later...
  this.creds = { type: 'anonymous' };

  this._setLoginCallbacks(fn);
  this._makeLandingPageRequest();
};

/**
 * Creates the connection to the Spotify Web websocket server and logs in using
 * the given Facebook App OAuth token and corresponding user ID.
 *
 * @param {String} fbuid facebook user Id
 * @param {String} token oauth token
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.facebookLogin = function (fbuid, token, fn) {
  debug('Spotify#facebookLogin(%j, %j)', fbuid, token);

  // save credentials for later...
  this.creds = { fbuid: fbuid, token: token, type: 'fb' };

  this._setLoginCallbacks(fn);
  this._makeLandingPageRequest();
};

/**
 * Sets the login and error callbacks to invoke the specified callback function
 * 
 * @param {Function} fn callback function
 * @api private
 */

Spotify.prototype._setLoginCallbacks = function(fn) {
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
};

/**
 * Makes a request for the landing page to get the CSRF token.
 *
 * @api private
 */

Spotify.prototype._makeLandingPageRequest = function() {
  var url = 'https://' + this.authServer + this.landingUrl;
  debug('GET %j', url);
  this.agent.get(url)
    .set({ 'User-Agent': this.userAgent })
    .end(this._onsecret.bind(this));
};

/**
 * Called when the Facebook redirect URL GET (and any necessary redirects) has
 * responded.
 *
 * @api private
 */

Spotify.prototype._onsecret = function (err, res) {
  if (err) return this.emit('error', err);

  debug('landing page: %d status code, %j content-type', res.statusCode, res.headers['content-type']);
  var $ = cheerio.load(res.text);

  // need to grab the CSRF token and trackingId from the page.
  // currently, it's inside an Object that gets passed to a
  // `new Spotify.Web.Login()` call as the second parameter.
  var args;
  var scripts = $('script');
  function login (doc, data) {
    debug('Spotify.Web.Login()');
    args = data;
    return { init: function () { /* noop */ } };
  }
  for (var i = 0; i < scripts.length; i++) {
    var code = scripts.eq(i).text();
    if (~code.indexOf('Spotify.Web.Login')) {
      vm.runInNewContext(code, { document: null, Spotify: { Web: { Login: login } } });
    }
  }
  debug('login CSRF token: %j, tracking ID: %j', args.csrftoken, args.trackingId);

  // construct credentials object to send from stored credentials
  var creds = this.creds;
  delete this.creds;
  creds.secret = args.csrftoken;
  creds.trackingId = args.trackingId;
  creds.landingURL = args.landingURL;
  creds.referrer = args.referrer;
  creds.cf = null;

  // now we have to "auth" in order to get Spotify Web "credentials"
  var url = 'https://' + this.authServer + this.authUrl;
  debug('POST %j', url);
  this.agent.post(url)
    .set({ 'User-Agent': this.userAgent })
    .type('form')
    .send(creds)
    .end(this._onauth.bind(this));
};

/**
 * Called upon the "auth" endpoint's HTTP response.
 *
 * @api private
 */

Spotify.prototype._onauth = function (err, res) {
  if (err) return this.emit('error', err);

  debug('auth %d status code, %j content-type', res.statusCode, res.headers['content-type']);
  if ('ERROR' == res.body.status) {
    // got an error...
    var msg = res.body.error;
    if (res.body.message) msg += ': ' + res.body.message;
    this.emit('error', new Error(msg));
  } else {
    this.settings = res.body.config;
    this._resolveAP();
  }
};

/**
 * Resolves the WebSocket AP to connect to
 * Should be called after the _onauth() function
 *
 * @api private
 */

Spotify.prototype._resolveAP = function () {
  var query = { client: '24:0:0:' + this.settings.version };
  var resolver = this.settings.aps.resolver;
  debug('ap resolver %j', resolver);
  if (resolver.site) query.site = resolver.site;

  // connect to the AP resolver endpoint in order to determine
  // the WebSocket server URL to connect to next
  var url = 'http://' + resolver.hostname;
  debug('GET %j', url);
  this.agent.get(url)
    .set({ 'User-Agent': this.userAgent })
    .query(query)
    .end(this._openWebsocket.bind(this));
};

/**
 * Opens the WebSocket connection to the Spotify Web server.
 * Should be called upon AP resolver's response.
 *
 * @api private.
 */

Spotify.prototype._openWebsocket = function (err, res) {
  if (err) return this.emit('error', err);

  debug('ap resolver %d status code, %j content-type', res.statusCode, res.headers['content-type']);
  var ap_list = res.body.ap_list;
  var url = 'wss://' + ap_list[0] + '/';

  debug('WS %j', url);
  this.connection.connect(url, this._onconnect.bind(this));
};

/**
 * Handles a "message" command. Specifically, handles the "do_work" command and
 * executes the specified JavaScript in the VM.
 *
 * @api private
 */

Spotify.prototype._onmessagecommand = function (command, args) {
  if ('do_work' == command) {
    var js = args[0];
    debug('got "do_work" payload: %j', js);
    try {
      vm.runInContext(js, this._context);
    } catch (e) {
      this.emit('error', e);
    }
  } else if ('ping_flash2' == command) {
    this.sendPong(args[0]);
  } else if ('login_complete' == command) {
    // ignore...
  } else {
    // unhandled message
    debug('unhandled %j command, args: %j', command, args);
  }
};

/**
 * Called when the "sp/work_done" command is completed.
 *
 * @api private
 */

Spotify.prototype._onworkdone = function (err, res) {
  if (err) return this.emit('error', err);
  debug('"sp/work_done" ACK');
};

/**
 * Responds to a sp/ping_flash2 request
 *
 * This request is usually handled by Flash, and in a perfect world we would
 * execute the "original" Flash code directly with Shumway.
 *
 * Instead, this implementes a reverse-engineered algorithm that is estimated
 * to produce the same output for 20-byte inputs, tested with
 * Client version: 0.6.23.160, Hash: 3f1a035, Deployed at: 2014-02-13 15:06 UTC.
 *
 * @param {String} ping the argument sent from the request
 */
Spotify.prototype.sendPong = function(ping) {
  var pong = "undefined 0";
  var input = ping.split(' ');
  if (input.length >= 20) {
    var key = [[19,104],[16,19],[0,41],[3,133],[10,175],[1,240],[5,150],[17,116],[7,240],[13,0]];
    var output = new Array(key.length);
    for (var i = 0; i < key.length; i++) {
      var idx = key[i][0];
      var xor = key[i][1];
      output[i] = input[idx] ^ xor;
    }
    pong = output.join(' ');
  }
  debug('received flash ping %j, sending pong: %j', ping, pong);
  this.sendCommand('sp/pong_flash2', [pong]);
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
    args = null;
  }
  var request = new this.connection.Request(name, args)
  request.send(fn);
};

/**
 * Makes a Protobuf request over the WebSocket connection. 
 * Also known as a MercuryRequest or Hermes Call.
 *
 * @param {Object} req protobuf request object
 * @param {Function} fn (optional) callback function
 * @api public
 */

Spotify.prototype.sendProtobufRequest = function(req, fn) {
  debug('sendProtobufRequest(%j)', req);

  // extract request object 
  var isMultiGet = req.isMultiGet || false;
  var payload = req.payload || [];
  var header = {
      uri: '',
      method: '',
      source: '',
      contentType: isMultiGet ? 'vnd.spotify/mercury-mget-request' : ''
  };
  if (req.header) {
    header.uri = req.header.uri || '';
    header.method = req.header.method || '';
    header.source = req.header.source || '';
  }

  // load payload and response schemas
  var loadSchema = function(schema, dontRecurse) {
    if ('string' === typeof schema) {
      var schemaName = schema.split("#");
      schema = schemas.build(schemaName[0], schemaName[1]);
      if (!schema)
        throw new Error('Could not load schema: ' + schemaName.join('#'));
    } else if (schema && !dontRecurse && (!schema.hasOwnProperty('parse') && !schema.hasOwnProperty('serialize'))) {
      var keys = Object.keys(schema);
      keys.forEach(function(key) {
        schema[key] = loadSchema(schema[key], true);
      });
    }
    return schema;
  };

  var payloadSchema = isMultiGet ? MercuryMultiGetRequest : loadSchema(req.payloadSchema);
  var responseSchema = loadSchema(req.responseSchema);
  var isMultiResponseSchema = (!responseSchema.hasOwnProperty('parse'));

  var parseData = function(type, data, dontRecurse) {
    var parser = responseSchema;
    var ret;
    if (!dontRecurse && 'vnd.spotify/mercury-mget-reply' == type) {
      ret = [];
      var response = self._parse(MercuryMultiGetReply, data);
      response.reply.forEach(function(reply) {
        var data = parseData(reply.contentType, new Buffer(reply.body, 'base64'), true);
        ret.push(data);
      });
      debug('parsed multi-get response - %d items', ret.length);
    } else {
      if (isMultiResponseSchema) {
        if (responseSchema.hasOwnProperty(type)) {
          parser = responseSchema[type];
        } else {
          throw new Error('Unrecognised metadata type: ' + type);
        }
      }
      ret = self._parse(parser, data);
      debug('parsed response: [ %j ] %j', type, ret);
    }
    return ret;
  };

  function getNumber (method) {
    switch(method) {
    case "SUB":
      return 1;
    case "UNSUB":
      return 2;
    default:
      return 0;
    }
  }

  // construct request
  var args = [ getNumber(header.method) ];
  var data = MercuryRequest.serialize(header).toString('base64');
  args.push(data);

  if (isMultiGet) {
    if (Array.isArray(req.payload)) {
      req.payload = {request: req.payload};
    } else if (!req.payload.request) {
      throw new Error('Invalid payload for Multi-Get Request.');
    }
  }

  if (payload && payloadSchema) {
    data = payloadSchema.serialize(req.payload).toString('base64');
    args.push(data);
  }

  // send request and parse response, pass data back to callback
  var self = this;
  this.sendCommand('sp/hm_b64', args, function (err, res) {
    if ('function' !== typeof fn) return; // give up if no callback
    if (err) return fn(err);

    var header = self._parse(MercuryRequest, new Buffer(res.result[0], 'base64'));
    debug('response header: %j', header);

    // TODO: proper error handling, handle 300 errors

    var message;
    if (header.statusCode >= 400 && header.statusCode < 500) {
      message = header.statusMessage || http.STATUS_CODES[header.statusCode] || 'Unknown Error';
      return fn(new Error('Client Error: ' + message + ' (' + header.statusCode + ')'));
    }

    if (header.statusCode >= 500 && header.statusCode < 600) {
      message = header.statusMessage || http.STATUS_CODES[header.statusCode] || 'Unknown Error';
      return fn(new Error('Server Error: ' + message + ' (' + header.statusCode + ')'));
    }

    if (isMultiGet && 'vnd.spotify/mercury-mget-reply' !== header.contentType)
      return fn(new Error('Server Error: Server didn\'t send a multi-GET reply for a multi-GET request!'));

    var data = parseData(header.contentType, new Buffer(res.result[1], 'base64'));
    fn(null, data);
  });
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
  this.connection.sendConnect(fn);
};

/**
 * Closes the WebSocket connection of present. This effectively ends your Spotify
 * Web "session" (and derefs from the event-loop, so your program can exit).
 *
 * @api public
 */

Spotify.prototype.disconnect = function () {
  debug('disconnect()');
  this.connection.disconnect();
};

/**
 * Gets the "metadata" object for one or more URIs.
 *
 * This function returns a single object or array of objects (depending on if the input is a String or Array)
 * with each object only populated with the URI. To get the metadata for the object, use the .get() or .metadata()
 * methods on the object.
 *
 * For backwards compatiblity, a callback function is also supported which automatically grabs the metadata before 
 * calling back with each new metadata object
 *
 * @param {Array|String} uris A single URI, or an Array of URIs to get "metadata" for
 * @param {Function} fn callback function invoked once for each uri
 * @param {Boolean} loadMetadata
 * @return {Array|Object}
 * @api public
 */

Spotify.prototype.get =
Spotify.prototype.metadata = function (uris, fn, loadMetadata) {
  debug('metadata(%j)', uris);
  
  // convert input uris to array but save if we should return an array or a bare object
  var returnArray = Array.isArray(uris);
  if (!returnArray) uris = [uris];

  loadMetadata = ('undefined' !== typeof loadMetadata) ? loadMetadata : ('function' == typeof fn);
  fn = util.wrapCallback(fn, this);

  var types = ['track', 'artist', 'album'];
  var objects = uris.map(function (uri) {
    var type = SpotifyUri.uriType(uri);
    if (-1 == types.indexOf(type)) return null;
    var typeName = type.charAt(0).toUpperCase() + type.substring(1).toLowerCase();
    var object = null;
    var err = null;
    try {
      object = new this[typeName](uri);
    } catch (e) {
      err = e;
    }

    if (err) {
      process.nextTick(fn.bind(null, err));
    } else if (loadMetadata) {
      // for backwards compatibility we load in the metadata of the object before calling back
      object.get(fn);
    }

    return object;
  }, this);
  return (returnArray) ? objects : objects[0];
};

/**
 * Gets the metadata from a Spotify "playlist" URI.
 *
 * @param {String} uri playlist uri
 * @param {Number} from (optional) the start index. defaults to 0.
 * @param {Number} length (optional) number of tracks to get. defaults to 100.
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.playlist = function (uri, from, length, fn) {
  // argument surgery
  if ('function' == typeof from) {
    fn = from;
    from = length = null;
  } else if ('function' == typeof length) {
    fn = length;
    length = null;
  }
  if (null == from) from = 0;
  if (null == length) length = 100;

  debug('playlist(%j, %j, %j)', uri, from, length);
  var self = this;
  var parts = uri.split(':');
  var user = parts[2];
  var id = parts[4];
  var hm = 'hm://playlist/user/' + user + '/playlist/' + id +
    '?from=' + from + '&length=' + length;

  this.sendProtobufRequest({
    header: {
      method: 'GET',
      uri: hm
    },
    responseSchema: SelectedListContent
  }, fn);
};

/**
 * Gets the user's stored playlists
 *
 * @param {Number} from (optional) the start index. defaults to 0.
 * @param {Number} length (optional) number of tracks to get. defaults to 100.
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.rootlist = function (user, from, length, fn) {
  // argument surgery
  if ('function' == typeof user) {
    fn = user;
    from = length = user = null;
  } else if ('function' == typeof from) {
    fn = from;
    from = length = null;
  } else if ('function' == typeof length) {
    fn = length;
    length = null;
  }
  if (null == user) user = this.username;
  if (null == from) from = 0;
  if (null == length) length = 100;

  debug('rootlist(%j, %j, %j)', user, from, length);

  var self = this;
  var hm = 'hm://playlist/user/' + user + '/rootlist?from=' + from + '&length=' + length;

  this.sendProtobufRequest({
    header: {
      method: 'GET',
      uri: hm
    },
    responseSchema: SelectedListContent
  }, fn);
};

/**
 * Retrieve suggested similar tracks to the given track URI
 * 
 * @param {String} uri track uri
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.similar = function(uri, fn) {
  debug('similar(%j)', uri);  

  var parts = uri.split(':');
  var type = parts[1];
  var id = parts[2];

  if (!type || !id || 'track' != type)
    throw new Error('uri must be a track uri');

  this.sendProtobufRequest({
    header: {
      method: 'GET',
      uri: 'hm://similarity/suggest/' + id
    },
    payload: {
      country: this.country || 'US',
      language: this.settings.locale.current || 'en',
      device: 'web'
    },
    payloadSchema: StoryRequest,
    responseSchema: StoryList
  }, fn);
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
  // TODO: make "format" configurable here
  this.recurseAlternatives(track, this.country, function (err, track) {
    if (err) return fn(err);
    var args = [ 'mp3160', util.gid2id(track.gid) ];
    debug('sp/track_uri args: %j', args);
    this.sendCommand('sp/track_uri', args, function (err, res) {
      if (err) return fn(err);
      fn(null, res.result);
    });
  }.bind(this));
};

/**
 * Checks if the given track "metadata" object is "available" for playback, taking
 * account for the allowed/forbidden countries, the user's current country, the
 * user's account type (free/paid), etc.
 *
 * @param {Object} track Track "metadata" instance
 * @param {String} country 2 letter country code to check if the track is playable for
 * @return {Boolean} true if track is playable, false otherwise
 * @api public
 */

Spotify.prototype.isTrackAvailable = function (track, country) {
  if (!country) country = this.country;
  debug('isTrackAvailable()');

  var allowed = [];
  var forbidden = [];
  var available = false;
  var restriction;

  if (Array.isArray(track.restriction)) {
    for (var i = 0; i < track.restriction.length; i++) {
      restriction = track.restriction[i];
      allowed.push.apply(allowed, restriction.allowed);
      forbidden.push.apply(forbidden, restriction.forbidden);

      var isAllowed = !restriction.hasOwnProperty('countriesAllowed') || has(allowed, country);
      var isForbidden = has(forbidden, country) && forbidden.length > 0;

      // guessing at names here, corrections welcome...
      var accountTypeMap = {
        premium: 'SUBSCRIPTION',
        unlimited: 'SUBSCRIPTION',
        free: 'AD'
      };

      if (has(allowed, country) && has(forbidden, country)) {
        isAllowed = true;
        isForbidden = false;
      }

      var type = accountTypeMap[this.accountType] || 'AD';
      var applicable = has(restriction.catalogue, type);

      available = isAllowed && !isForbidden && applicable;

      //debug('restriction: %j', restriction);
      debug('type: %j', type);
      debug('allowed: %j', allowed);
      debug('forbidden: %j', forbidden);
      debug('isAllowed: %j', isAllowed);
      debug('isForbidden: %j', isForbidden);
      debug('applicable: %j', applicable);
      debug('available: %j', available);

      if (available) break;
    }
  }
  return available;
};

/**
 * Checks if the given "track" is "available". If yes, returns the "track"
 * untouched. If no, then the "alternative" tracks array on the "track" instance
 * is searched until one of them is "available", and then returns that "track".
 * If none of the alternative tracks are "available", returns `null`.
 *
 * @param {Object} track Track "metadata" instance
 * @param {String} country 2 letter country code to attempt to find a playable "track" for
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.recurseAlternatives = function (track, country, fn) {
  debug('recurseAlternatives()');
  function done () {
    process.nextTick(function () {
      fn(null, track);
    });
  }
  if (this.isTrackAvailable(track, country)) {
    return done();
  } else if (Array.isArray(track.alternative)) {
    var tracks = track.alternative;
    for (var i = 0; i < tracks.length; i++) {
      debug('checking alternative track %j', track.uri);
      track = tracks[i];
      if (this.isTrackAvailable(track, country)) {
        return done();
      }
    }
  }
  // not playable
  process.nextTick(function () {
    fn(new Error('Track is not playable in country "' + country + '"'));
  });
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
      if (!types.hasOwnProperty(t)) {
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
  this.sendCommand('sp/search', args, function (err, res) {
    if (err) return fn(err);
    // XML-parsing is left up to the user, since they may want to use libxmljs,
    // or node-sax, or node-xml2js, or whatever. So leave it up to them...
    fn(null, res.result);
  });
};

/**
 * Sends the "sp/track_end" event. This is required after each track is played,
 * otherwise Spotify limits you to 3 track URL fetches per session.
 *
 * @param {String} lid the track "lid"
 * @param {String} uri track spotify uri (not playback uri)
 * @param {Number} ms number of milliseconds played
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.sendTrackEnd = function (lid, uri, ms, fn) {
  debug('sendTrackEnd(%j, %j, %j)', lid, uri, ms);
  if (!fn) fn = this._defaultCallback;

  var ms_played = Number(ms);
  var ms_played_union = ms_played;
  var n_seeks_forward = 0;
  var n_seeks_backward = 0;
  var ms_seeks_forward = 0;
  var ms_seeks_backward = 0;
  var ms_latency = 100;
  var display_track = null;
  var play_context = 'unknown';
  var source_start = 'unknown';
  var source_end = 'unknown';
  var reason_start = 'unknown';
  var reason_end = 'unknown';
  var referrer = 'unknown';
  var referrer_version = '0.1.0';
  var referrer_vendor = 'com.spotify';
  var max_continuous = ms_played;
  var args = [
    lid,
    ms_played,
    ms_played_union,
    n_seeks_forward,
    n_seeks_backward,
    ms_seeks_forward,
    ms_seeks_backward,
    ms_latency,
    display_track,
    play_context,
    source_start,
    source_end,
    reason_start,
    reason_end,
    referrer,
    referrer_version,
    referrer_vendor,
    max_continuous
  ];
  this.sendCommand('sp/track_end', args, function (err, res) {
    if (err) return fn(err);
    if (null == res.result) {
      // apparently no result means "ok"
      fn();
    } else {
      // TODO: handle error case
    }
  });
};

/**
 * Sends the "sp/track_event" event. These are pause and play events (possibly
 * others).
 *
 * @param {String} lid the track "lid"
 * @param {String} event
 * @param {Number} ms number of milliseconds played so far
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.sendTrackEvent = function (lid, event, ms, fn) {
  debug('sendTrackEvent(%j, %j, %j)', lid, event, ms);
  var num = event;
  var args = [ lid, num, ms ];
  this.sendCommand('sp/track_event', args, function (err, res) {
    if (err) return fn(err);
    console.log(res);
  });
};

/**
 * Sends the "sp/track_progress" event. Should be called periodically while
 * playing a Track.
 *
 * @param {String} lid the track "lid"
 * @param {Number} ms number of milliseconds played so far
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.sendTrackProgress = function (lid, ms, fn) {
  debug('sendTrackProgress(%j, %j)', lid, ms);
  var ms_played = Number(ms);
  var source_start = 'unknown';
  var reason_start = 'unknown';
  var ms_latency = 100;
  var play_context = 'unknown';
  var display_track = '';
  var referrer = 'unknown';
  var referrer_version = '0.1.0';
  var referrer_vendor = 'com.spotify';
  var args = [
    lid,
    source_start,
    reason_start,
    ms_played,
    ms_latency,
    play_context,
    display_track,
    referrer,
    referrer_version,
    referrer_vendor
  ];
  this.sendCommand('sp/track_progress', args, function (err, res) {
    if (err) return fn(err);
    console.log(res);
  });
};

/**
 * "connect" command callback function. If the result was "ok", then get the
 * logged in user's info.
 *
 * @param {Object} res response Object
 * @api private
 */

Spotify.prototype._onconnect = function (err, res) {
  this.emit('connect');
  this.sendCommand('sp/user_info', this._onuserinfo.bind(this));
  this.sendCommand('sp/log', [41, 1, 0, 0, 0, 0]); // Spotify.Logging.Logger#logWindowSize
};

/**
 * "sp/user_info" command callback function. Once this is complete, the "login"
 * event is emitted and control is passed back to the user for the first time.
 *
 * @param {Object} res response Object
 * @api private
 */

Spotify.prototype._onuserinfo = function (err, res) {
  if (err) return this.emit('error', err);
  this.user_info = res.result;
  this.emit('login');
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

/**
 * Default callback function for when the user does not pass a
 * callback function of their own.
 *
 * @param {Error} err
 * @api private
 */

Spotify.prototype._defaultCallback = function (err) {
  if (err) this.emit('error', err);
};

/**
 * Wrapper around the Protobuf Schema's `parse()` function that also attaches this
 * Spotify instance as `_spotify` to each entry in the parsed object. This is
 * necessary so that instance methods (like `Track#play()`) have access to the
 * Spotify instance in order to interact with it.
 *
 * @api private
 */

Spotify.prototype._parse = function (parser, data) {
  var obj = parser.parse(data);
  tag(this, obj);
  return obj;
};

/**
 * XXX: move to `util`?
 * Attaches the `_spotify` property to each "object" in the passed in `obj`.
 *
 * @api private
 */

function tag(spotify, obj){
  if (obj === null || 'object' != typeof obj) return;
  Object.keys(obj).forEach(function(key){
    var val = obj[key];
    var type = typeof val;
    if ('object' == type) {
      if (Array.isArray(val)) {
        val.forEach(function (v) {
          tag(spotify, v);
        });
      } else {
        tag(spotify, val);
      }
    }
  });
  Object.defineProperty(obj, '_spotify', {
    value: spotify,
    enumerable: false,
    writable: true,
    configurable: true
  });
}

/**
 * XXX: move to `util`?
 * Returns `true` if `val` is present in the `array`. Returns `false` otherwise.
 *
 * @api private
 */

function has (array, val) {
  var rtn = false;
  if (Array.isArray(array)) {
    rtn = !!~array.indexOf(val);
  }
  return rtn;
}
