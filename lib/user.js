
/**
 * Module dependencies.
 */

var schemas = require('./schemas');
var util = require('./util');
var debug = require('debug')('spotify-web:user');

/**
 * Protocol Buffer types.
 */

var SocialDecorationData = schemas.build('social','DecorationData');
var PresenceState = schemas.build('presence','State');

/**
 * Module exports.
 */

exports = module.exports = User;

/**
 * Creates a new User instance with the specified username or uri, 
 * or in the case of multiple usernames or uris, creates an array of new User instances.
 *
 * Instances will only contain a username and will not have any metadata populated
 *
 * @param {Object} spotify Spotify object instance
 * @param {Array|String} uris A single username or user URI, or an Array
 * @param {Function} (Optional) fn callback function
 * @return {Array|Album}
 * @api public
 */

User.get = function(spotify, uri, fn) {
  debug('get(%j)', uri);

  // convert input uris to array but save if we should return an array or a bare object
  var returnArray = Array.isArray(uri);
  if (!returnArray) uri = [uri];

  // call the Album constructor for each uri, and call the callback if we have an error
  var users;
  try {
    users = uri.map(User.bind(null, spotify));
  } catch (e) {
    return process.nextTick(fn.bind(null, e));
  }

  // return the array of albums or a single album and call callbacks if applicable
  var ret = (returnArray) ? users : users[0];
  if ('function' == typeof fn) process.nextTick(fn.bind(null, null, ret));
  return ret;
};
User.get['$inject'] = ['Spotify'];

/**
 * User class.
 *
 * @api public
 */

function User (spotify, username) {
  if (!(this instanceof User)) return new User(spotify, username);
  this._spotify = spotify;
  if ('string' == typeof username) {
    if (/:/.test(username)) {
      this.uri = new SpotifyUri(username);
      if ('user' != this.uri.type) throw new Error('Invalid URI Type: ' + type);
    } else {
      this.uri = new SpotifyUri('user', username);
    }
  } else {
    throw new Error('ArgumentError: Invalid arguments');
  }

  this._loaded = false;
}
User['$inject'] = ['Spotify'];

/**
 * Username getter / setter
 */

Object.defineProperty(User.prototype, 'username', {
  get: function () {
    return this.uri.user;
  },
  set: function (username) {
    this.uri.user = username;
  },
  enumerable: true,
  configurable: true
});

/**
 * isCurrentUser getter
 */

Object.defineProperty(User.prototype, 'isCurrentUser', {
  get: function () {
    return this._spotify.username == this.username;
  },
  enumerable: true,
  configurable: true
});

/**
 * Update the User instance with the properties of another object
 *
 * @param {SocialDecorationData} user
 * @api private
 */
User.prototype._update = function(user) {
  var self = this;
  var spotify = this._spotify;

  Object.keys(user).forEach(function (key) {
    if (!self.hasOwnProperty(key)) {
      self[key] = spotify._objectify(user[key]);
    }
  });

  this._loaded = true;
};

/**
 * Loads all the metadata for this User instance. 
 *
 * @param {Boolean} (Optional) refresh
 * @param {Function} fn callback function
 * @api public
 */

User.prototype.get =
User.prototype.metadata = function (refresh, fn) {
  // argument surgery
  if ('function' == typeof refresh) {
    fn = refresh;
    refresh = false;
  }

  debug('metadata(%j)', refresh);

  var self = this;
  var spotify = this._spotify;

  if (!refresh && this._loaded) {
    // already been loaded...
    debug('user already loaded');
    return process.nextTick(fn.bind(null, null, this));
  }

  var request = new spotify.HermesRequest('hm://social/decoration/user/' + encodeURIComponent(this.username));
  request.setResponseSchema(SocialDecorationData);
  request.send(function(err, res) {
    if (err) return fn(err);
    self._update(res.result);
    fn(null, self);
  });
};

/**
 * Get the user's recent activity
 * 
 * @param {Function} fn callback
 */
User.prototype.activity = function(fn) {
  debug('activity()');
  var spotify = this._spotify;
  var request = new spotify.HermesRequest('hm://presence/user/');
  request.setResponseSchema(PresenceState);
  request.send((new Buffer(this.username)).toString('base64'), function(err, res) {
    if (err) return fn(err);
    //TODO
    fn(null, res.result);
  });
};

User.prototype.following = function() {
  throw new Error('TODO: implement');
};

User.prototype.followers = function() {
  throw new Error('TODO: implement');
};

/**
 * Gets the user's stored playlists
 *
 * @param {String} type (optional) the rootlist type (either 'rootlist' or 'publishedrootlist')
 * @api public
 */

User.prototype.rootlist = function(type) {
  if (!type) {
    type = (this.isCurrentUser) ? 'rootlist' : 'publishedrootlist';
  }

  return this._spotify.Playlist(['spotify', 'user', this.username, rootlistType].join(':'));
};

User.prototype.starred = function() {
  throw new Error('TODO: implement');
};
