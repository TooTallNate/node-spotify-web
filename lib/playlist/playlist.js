
/**
 * Module dependencies.
 */

var schemas = require('../schemas');
var util = require('../util');
var SpotifyUri = require('../uri');
var PlaylistAttributes = require('./attributes');
var PlaylistChange = require('./change');
var PlaylistContents = require('./contents');
var PlaylistItem = require('./item');
var PlaylistRevision = require('./revision');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var querystring = require('querystring');
var debug = require('debug')('spotify-web:playlist');

/**
 * Module exports.
 */

module.exports = Playlist;

/**
 * Protocol Buffer types.
 */

var SelectedListContent = schemas.build('playlist4', 'SelectedListContent');
var OpList = schemas.build('playlist4', 'OpList');
var SubscribeRequest = schemas.build('playlist4', 'SubscribeRequest');
var UnsubscribeRequest = schemas.build('playlist4', 'UnsubscribeRequest');
var Subscription = schemas.build('hermes.pubsub', 'Subscription');
var CreateListReply = schemas.build('playlist4', 'CreateListReply');
var ModifyReply = schemas.build('playlist4', 'ModifyReply');
var PlaylistModificationInfo = schemas.build('playlist4', 'PlaylistModificationInfo');

/**
 * Creates a new Playlist instance with the specified uri, or in the case of multiple uris, 
 * creates an array of new Playlist instances.
 *
 * Instances will only contain a URI and will not have metadata populated
 *
 * @param {Object} spotify Spotify object instance
 * @param {Array|String} uris A single URI, or an Array of URIs to get Playlist instances for
 * @param {Function} (Optional) fn callback function
 * @return {Array|Metadata}
 * @api public
 */

Playlist.get = function(spotify, uri, fn) {
  debug('get(%j)', uri);

  // convert input uris to array but save if we should return an array or a bare object
  var returnArray = Array.isArray(uri);
  if (!returnArray) uri = [uri];

  // call the Playlist constructor for each uri, and call the callback if we have an error
  var playlists;
  try {
    playlists = uri.map(Playlist.bind(null, spotify));
  } catch (e) {
    if ('function' == typeof fn) process.nextTick(fn.bind(null, e));
    return null;
  }

  // return the array of playlists or a single playlist and call callbacks if applicable
  var ret = (returnArray) ? playlists : playlists[0];
  if ('function' == typeof fn) process.nextTick(fn.bind(null, null, ret));
  return ret;
};
Playlist.get['$inject'] = ['Spotify'];

/**
 * Create a new Playlist on the server, optionally with the specified attributes.
 *
 * @param {String|Object} (Optional) attributes object or playlist name
 * @param {Function} fn callback function
 */
Playlist.create = function(spotify, attributes, fn) {
  if ('string' == typeof attributes) {
    attributes = {name: attributes};
  }
  debug('create(%j)', attributes);

  var requestArgs = {
    ops: [{
      kind: 'UPDATE_LIST_ATTRIBUTES',
      updateListAttributes: {
        newAttributes: { values: attributes }
      }
    }]
  };

  var HermesRequest = spotify.HermesRequest;
  var request = new HermesRequest('PUT', 'hm://playlist/user/' + spotify.username);
  request.setRequestSchema(OpList);
  request.setResponseSchema(CreateListReply);
  request.send(requestArgs, function (err, res) {
    if (err) fn(err);
    debug('playlist created - uri = %s', res.result.uri);

    // TODO(adammw): add item to the user's rootlist
    var playlist = new Playlist(spotify, res.result.uri.toString());
    playlist._revision = new playlist.PlaylistRevision(res.result.revision);
    fn(null, playlist);
  });
};
Playlist.create['$inject'] = ['Spotify'];

/**
 * Playlist class.
 *
 * @api public
 */

function Playlist (spotify, uri) {
  if (!(this instanceof Playlist)) return new Playlist(spotify, uri);

  // initalise event emitters
  EventEmitter.call(this);
  EventEmitter.call(this.contents);
  EventEmitter.call(this.revision);
  this.on('newListener', this._onNewListener.bind(this));
  this.on('removeListener', this._onRemoveListener.bind(this));
  this.contents.on('newListener', this.contents._onNewListener.bind(this));
  this.contents.on('removeListener', this.contents._onRemoveListener.bind(this));
  this.revision.on('newListener', this.revision._onNewListener.bind(this));
  this.revision.on('removeListener', this.revision._onRemoveListener.bind(this));

  this._spotify = spotify;
  this._attributesCache = null;
  this._contentsCache = []; // TODO(adammw): an opt-in caching policy (and also for playlist to be a singleton per uri so caches are shared)
  this._revision = null;

  // validate and parse uri
  if (!uri) throw new Error('Invalid uri specified');
  if ('string' == typeof uri) uri = new SpotifyUri(uri);
  if (!(uri instanceof SpotifyUri) || 'playlist' != uri.type) throw new Error('Invalid URI type');

  this._hm_uri = 'hm://playlist/user/' + uri.user + '/playlist/' + uri.sid;
  // TODO(adammw): support spotify:user:xxx:rootlist -> hm://playlist/user/xxx/rootlist
  // and spotify:user:xxx:starred -> hm://playlist/user/xxx/starred

  this._subscription = new spotify.connection.Subscription(this._hm_uri);
  this._subscription.setSubscribeHandler(this._sendSubscribe.bind(this));
  this._subscription.setUnsubscribeHandler(this._sendUnsubscribe.bind(this));
  this._subscription.setResponseSchema(PlaylistModificationInfo);
  this._subscription.on('response', this._onsubscriptionresponse.bind(this));
  this._onrevisionchange = this._performDiff.bind(this);
  this.once('needsRevision', this.revision.bind(this));
  
  this.uri = uri;
}
inherits(Playlist, EventEmitter);
Playlist['$inject'] = ['Spotify'];

/** 
 * Re-export namespaces
 */
util.export(Playlist, [ PlaylistAttributes, PlaylistChange, PlaylistContents, PlaylistItem, PlaylistRevision ]);

Playlist.prototype._onNewListener = function(event, listener) {
  if ('change' != event) return;

  this._addDiffChangeHandler();
};

Playlist.prototype._onRemoveListener = function(event, listener) {
  if ('change' != event) return;

  // count the remaining listeners
  var count = 0;
  Playlist._diffEvents.forEach(function(countEvent) {
    count += this.contents.listeners(countEvent).length;
  }, this);

  var listeners = this.listeners('change');
  var idx;
  if (-1 !== (idx = listeners.indexOf(listener))) {
    listeners.splice(idx, 1);
  }
  count += listeners.length;

  // abort if listeners remain
  if (0 != count) return;

  this._removeDiffChangeHandler();
};

/**
 * Perform a DIFF
 */
Playlist.prototype._performDiff = function(newRevision, oldRevision) {
  if (!oldRevision || newRevision.toString() == oldRevision.toString()) return;
  debug('performDiff(%j, %j)', newRevision.toString(), oldRevision.toString());
  this.diff(oldRevision, (function(err, diff) {
    diff.ops.forEach(function(op) {
      var kind = op.kind.toLowerCase();
      if (['add', 'mov', 'rem'].indexOf(kind) !== -1) {
        this.contents.emit(kind, new this.PlaylistChange(diff, op));
      }
    }, this);
  }).bind(this));
};

/**
 * Add the handler for the revision 'change' event to perform a DIFF
 *
 * @api private
 */
Playlist.prototype._addDiffChangeHandler = function() {
  debug('_addDiffChangeHandler()');
  if (-1 === this.revision.listeners('change').indexOf(this._onrevisionchange)) {
    this.revision.addListener('change', this._onrevisionchange);
    if (!this._revison) this.emit('needsRevision');
  }
};

/**
 * Remove the handler for the revision 'change' event to perform a DIFF
 *
 * @api private
 */
Playlist.prototype._removeDiffChangeHandler = function() {
  debug('_removeDiffChangeHandler()');
  this.revision.removeListener('change', this._onrevisionchange);
};

/**
 * Perform a "SelectedListContent" request for playlist data
 * 
 * @param {String} (Optional) method
 * @param {Object} (Optional) args
 * @param {Function} fn callback
 * @api private
 */
Playlist.prototype._request = function(method, args, fn) {
  // argument surgery
  if ('function' == typeof args) {
    fn = args;
    args = null;
  }
  if ('function' == typeof method) {
    fn = method;
    args = method = null;
  }

  // construct url
  var hm_uri = this._hm_uri;
  if (args) hm_uri += '?' + querystring.stringify(args);

  // perform request
  var HermesRequest = this._spotify.HermesRequest;
  var request = new HermesRequest(method, hm_uri);
  request.setResponseSchema(SelectedListContent);
  request.send(fn);
};

/**
 * When a Playlist Subscription callback is invoked this function is called
 *
 * @param {HermesResponse} response
 */
Playlist.prototype._onsubscriptionresponse = function(response) {
  // TODO(adammw)
  var oldRevision = this._revision || null;
  var newRevision = (response.result.newRevision) ? new this.PlaylistRevision(response.result.newRevision) : null;
  debug('_onsubscriptionresponse %s -> %s', oldRevision, newRevision);
  if (newRevision) this._revision = newRevision;
  this.revision.emit('change', newRevision, oldRevision);
};

/**
 * Send a MODIFY request
 *
 * @param {Array} ops Array of operations to apply
 * @param {Function} fn request callback
 * @api private
 */
Playlist.prototype._sendOps = function (ops, fn) {
  var HermesRequest = this._spotify.HermesRequest;
  // TODO(adammw): work out which query string arguments are needed
  var request = new HermesRequest('MODIFY', this._hm_uri + '?syncpublished=true');
  request.setRequestSchema(OpList);
  request.setResponseSchema(ModifyReply);
  request.send({ops: ops}, fn);
};

/**
 * Send a Subscribe request
 *
 * @param {Function} fn request callback
 * @api private
 */
Playlist.prototype._sendSubscribe = function(fn) {
  var HermesRequest = this._spotify.HermesRequest;
  var request = new HermesRequest('SUB', 'hm://playlist/');
  request.setRequestSchema(SubscribeRequest);
  request.setResponseSchema(Subscription);
  request.send({ uris: [ this._hm_uri ]}, fn);
};

/**
 * Send an Unsubscribe request
 *
 * @param {Function} fn request callback
 * @api private
 */
Playlist.prototype._sendUnsubscribe = function(fn) {
  var HermesRequest = this._spotify.HermesRequest;
  var request = new HermesRequest('UNSUB', 'hm://playlist/');
  request.setRequestSchema(UnsubscribeRequest);
  request.send({ uris: [ this._hm_uri ]}, fn);
};

/**
 * Gets the playlist attributes
 *
 * @param {Function} fn callback function
 */
Playlist.prototype.attributes = function(fn) {
  var self = this;
  var PlaylistAttributes = this.PlaylistAttributes;
  this._request('HEAD', function(err, res) {
    if (err) return fn(err);
    var attributes = new PlaylistAttributes();
    try {
      attributes.parse(res.result);
    } catch(e) {
      return fn(e);
    }
    self._attributesCache = attributes;
    fn(null, attributes);
  });
};

/**
 * Retrieves changes to the playlist since the specified revision
 *
 * @param {PlaylistRevision} revision (optional)
 * @param {Function} fn callback function
 */
Playlist.prototype.diff = function(revision, fn) {
  // argument surgery
  if ('function' == revision) {
    fn = revision;
    revision = null;
  }
  fn = util.wrapCallback(fn, this);
  if (null === revision) revision = this._revision;
  // if ('string' != typeof revision && !(revision instanceof PlaylistRevision))
  //   return fn(new Error('Invalid revision'));

  this._request('DIFF', { revision: revision.toString() }, (function(err, res) {
    if (err) return fn(err);
    var diff = res.result.diff;
    debug('processing diff: %j', diff);
    if (diff.fromRevision) diff.fromRevision = new this.PlaylistRevision(diff.fromRevision);
    if (diff.toRevision) diff.toRevision = new this.PlaylistRevision(diff.toRevision);
    if (Array.isArray(diff.ops)) {
      diff.ops.forEach(function(op) {
        ['add', 'rem'].forEach(function(kind) {
          if (!op[kind] || !Array.isArray(op[kind].items)) return;
          op[kind].items = op[kind].items.map(function(item) {
            return new this.PlaylistItem(item.uri, item.attributes);
          }, this);
        }, this);
      }, this);
    }
    fn(null, diff);
  }).bind(this));
};

/**
 * Get the playlist contents
 *
 * @param {Number} offset (Optional)
 * @param {Number} length (Optional)
 * @param {Function} fn callback function
 */
Playlist.prototype.contents = function(offset, length, fn) {
  if ('function' == typeof length) {
    fn = length;
    length = null;
  }
  if ('function' == typeof offset) {
    fn = offset;
    offset = length = null;
  }

  debug('contents(%j, %j)', offset, length);

  // TODO(adammw): ensure this works with large playlists (ie >100 items)

  var PlaylistContents = this.PlaylistContents;
  this._request(function(err, res) {
    if (err) return fn(err);
    var contents = new PlaylistContents();
    try {
      contents.parse(res.result);
    } catch(e) {
      return fn(e);
    }
    // TODO(adammw): add to _contentsCache and ensure cache does not grow too big and stay around forever
    fn(null, contents);
  });
};

/*
 * Make `playlist.contents` an EventEmitter
 */
util.makeEmitter(Playlist.prototype.contents);

Playlist._diffEvents = ['add', 'mov', 'rem', 'mod', 'change'];

Playlist.prototype.contents._onNewListener = function(event, listener) {
  if (-1 === Playlist._diffEvents.indexOf(event)) return;

  this._addDiffChangeHandler();
};

Playlist.prototype.contents._onRemoveListener = function(event, listener) {
  if (-1 === Playlist._diffEvents.indexOf(event)) return;

  // count the remaining listeners
  var count = 0;
  Playlist._diffEvents.forEach(function(countEvent) {
    var listeners = this.contents.listeners(countEvent);

    // don't count the listener being removed
    if (event == countEvent) {
      var idx;
      if (-1 !== (idx = listeners.indexOf(listener))) {
        listeners.splice(idx, 1);
      }
    }

    count += listeners.length;
  }, this);

  count += this.listeners('change').length;

  // abort if listeners remain
  if (0 != count) return;

  this._removeDiffChangeHandler();
};

/**
 * Gets the latest revision from the server
 *
 * @param {Function} fn callback function
 */
Playlist.prototype.revision = function(fn) {
  debug('revision(%j)', arguments)
  var PlaylistRevision = this.PlaylistRevision;
  var self = this;
  fn = util.wrapCallback(fn);
  this._request('HEAD', function(err, res) {
    if (err) return fn(err);
    var revision = new PlaylistRevision(res.result.revision);
    fn(null, revision);
    process.nextTick(self.revision.emit.bind(self.revision, 'change', revision, self._revision));
    self._revision = revision;
  });
};

/*
 * Make `playlist.revision` an EventEmitter
 */
util.makeEmitter(Playlist.prototype.revision);

Playlist.prototype.revision._onNewListener = function(event, listener) {
  if ('change' != event) return;
  this.subscribe();
};

Playlist.prototype.revision._onRemoveListener = function(event, listener) {
  if ('change' != event) return;

  // count the remaining listeners
  var listeners = this.revision.listeners('change');
  var idx;
  if (-1 !== (idx = listeners.indexOf(listener))) {
    listeners.splice(idx, 1);
  }

  // abort if listeners remain
  if (listeners.length) return;

  this.unsubscribe();
};

/**
 * Deletes the Playlist represented by the Playlist instance on the server.
 * 
 * Note that Spotify playlists are never actually deleted, they are just removed from the user's rootlist
 *
 * @param {Function} fn callback function
 */
Playlist.prototype.delete = function(fn) {
  throw new Error('TODO: Not implemented!');
};

Playlist.prototype.publish =
Playlist.prototype.follow = function(fn) {
  throw new Error('TODO: Not implemented!');
};

Playlist.prototype.unpublish =
Playlist.prototype.unfollow = function(fn) {
  throw new Error('TODO: Not implemented!');
};

Playlist.prototype.subscribed = function() {
  return this._subscription.subscribed();
};

Playlist.prototype.subscribe = function() {
  this._subscription.subscribe();
};

Playlist.prototype.unsubscribe = function() {
  this._subscription.unsubscribe();
};
