
/**
 * Module dependencies.
 */

var util = require('./util');
var schemas = require('./schemas');
var inherits = require('util').inherits;
var Spotify = require('./spotify');
var EventEmitter = require('events').EventEmitter;
var SelectedListContent = schemas.playlist4changes['spotify.playlist4.proto.SelectedListContent'];
var OpList = schemas.playlist4ops['spotify.playlist4.proto.OpList'];
var ModifyReply = schemas.playlist4service['spotify.playlist4.proto.ModifyReply'];
var SubscribeRequest = schemas.playlist4service['spotify.playlist4.proto.SubscribeRequest'];
var Subscription = schemas.pubsub['spotify.hermes.pubsub.proto.Subscription'];
var PlaylistModificationInfo = schemas.playlist4service['spotify.playlist4.proto.PlaylistModificationInfo'];
var CreateListReply = schemas.playlist4service['spotify.playlist4.proto.CreateListReply'];

var debug = require('debug')('spotify-web:playlist');

/**
 * Module exports / Playlist constructor
 * 
 * @param {Object} spotify Spotify instance
 * @param {String} uri playlist uri
 * @param {Function} fn (optional) callback function for metadata request
 */

var Playlist = exports = module.exports = function(spotify, uri, fn){
  debug('Playlist(%j)', uri);

  if (!(this instanceof Playlist)) return new Playlist(spotify, uri);
  EventEmitter.call(this);

  if (!(spotify instanceof Spotify)) throw new Error('Spotify instance required');
  this._spotify = spotify;

  if ('playlist' != util.uriType(uri)) {
    throw new Error('Playlist requires a playlist uri');
  }

  if (spotify._playlistCache[uri] && spotify._playlistCache[uri] instanceof Playlist) return spotify._playlistCache[uri];
  spotify._playlistCache[uri] = this;

  this._uri = uri || null;
  
  this._revision = null;
  this._hmuri = null;
  this._isRootlist = false;
  this._data = null;
  this._contents = [];
  this._subscribed = false;

  this._parseUri();

  this.on('newListener', function(event) {
    if ('change' != event) return;
    self._subscribeToChanges();
  });
  /* // TODO: unsubscribe when all listeners removed
    this.on('removeListener', function(event) {
      if ('change' != event) return;
      if (self._subscribed && self.listeners('change').length == 0) {
        self._unsubscribeFromChanges();
      }
    });
  */

  // if the user has provided a get callback, execute the request
  if ('function' == typeof fn) this.get(fn);
};
inherits(Playlist, EventEmitter);

/**
 * Static Functions (require Spotify object to be sent as first argument)
 */

/**
 * Creates a new Playlist.
 *
 * @param {Object} spotify Spotify instance
 * @param {Object} attrs playlist attributes
 * @param {Function} fn callback function
 * @api public
 */

Playlist.create = function(spotify, attrs, fn) {
  if (!(spotify instanceof Spotify)) throw new Error('Spotify instance required');
  
  debug('Playlist.create(%j)', attrs);

  var newAttributes = {
    values: {
      name: attrs.name
    }
  };
  // TODO: Other attributes

  // Create the playlist
  var args = {
    header: {
      method: 'PUT',
      uri: 'hm://playlist/user/' + spotify.username
    },
    payload: {
      ops: [{
        kind: 'UPDATE_LIST_ATTRIBUTES',
        updateListAttributes: {
          newAttributes: newAttributes
        }
      }]
    },
    payloadSchema: OpList,
    responseSchema: CreateListReply
  };
  spotify.sendProtobufRequest(args, function(err, res) {
    if (err) return fn(err);
    if (!res.uri) return fn(new Error('Playlist URI not found'));

    var playlistUri = res.uri.toString();
    var revision = util.revision2string(res.revision);
    var playlist = new Playlist(spotify, playlistUri);

    debug('playlist created - uri = %j , revision = %j', playlistUri, revision);

    // Add the playlist to the rootlist
    var rootlist = new Playlist(spotify, 'spotify:user:' + spotify.username + ':rootlist');
    rootlist.add(playlistUri, true, function(err, res) {
      if (err) return fn(err); //TODO: should the new playlist be automatically deleted if an error occurs?

      debug('playlist added to rootlist, rootlist revision = %j', res.revision);

      fn(null, playlist);
    });
  });

  // TODO: return (dummy) playlist instance (difficult to do as we don't know the playlist uri yet)
};

/**
 * URI getter.
 */

Object.defineProperty(Playlist.prototype, 'uri', {
  get: function () {
    return this._uri;
  },
  enumerable: true,
  configurable: true
});

/**
 * Revision getter.
 */

Object.defineProperty(Playlist.prototype, 'revision', {
  get: function () {
    return this._revision;
  },
  enumerable: true,
  configurable: true
});


/**
 * Attributes getter / setter
 *
 * It is recommended to use the modifyAttributes method rather than the setter
 * as it allows for a completion callback.
 */

Object.defineProperty(Playlist.prototype, 'attributes', {
  get: function () {
    if (!this._data) return null;
    return this._data.attributes || null;
  },
  set: function(attributes) {
    this.modify(attributes);
  },
  enumerable: true,
  configurable: true
});

/**
 * Contents getter.
 */

Object.defineProperty(Playlist.prototype, 'contents', {
  get: function () {
    if (this.hasOwnProperty('_staticContents')) {
      return this._staticContents
    } else {
      return this._data.contents || null;
    }
  },
  enumerable: true,
  configurable: true
});

/**
 * Tracks getter.
 */

// TODO: coerce this.contents.items to Track objects
/*Object.defineProperty(Playlist.prototype, 'tracks', {
  get: function () {
    if (!this.contents) return null;
    var tracks = [];
    this.contents.items.forEach(function(item) {
      if ('track' == util.uriType(item.uri))
        tracks.push(new Track(item.uri));
    });
    return tracks;
  },
  enumerable: true,
  configurable: true
});*/

/**
 * Generic object extend helper
 */
function extend(obj, newObj) {
  Object.keys(newObj).forEach(function(key){
    obj[key] = newObj[key];
  });
}

/**
 * Calculate the hmuri and set isRootlist.
 * Must be called immediately after the uri is set.
 *
 * @api private
 */
Playlist.prototype._parseUri = function() {
  var parts = this._uri.split(':');
  var len = parts.length;
  var user = parts[2];

  this._hmuri = 'hm://playlist/user/' + user;

  if (len >= 5) {
    var id = parts[4];
    this._hmuri += '/playlist/' + id;
  } else if (len >= 4) { // e.g. spotify:user:xxx:rootlist and spotify:user:xxx:starred
    var id = parts[3];
    this._hmuri += '/' + id;
    this._isRootlist = ('rootlist' == id || 'publishedrootlist' == id);
  } else {
    throw new Error('Invalid playlist uri: ' + this._uri);
  }
};

/**
 * Handles changes to the Playlist when subscribed for changes
 *
 * @api private
 */

Playlist.prototype._onPlaylistModification = function(err, data) {
  if (err) return this.emit('error', err);

  var self = this;

  if (data.newRevision) {
    var newRevision = util.revision2string(data.newRevision);
    debug('playlist "%s" updated to revision "%s"', self._uri, newRevision);
    var listeners = self.listeners('change').length;
    if (listeners) {
      debug('requesting diff - %d listeners on change event', listeners);
      this.update(function(err, ops){
        if (err) return self.emit('error', err);
        self.emit('change', ops);
      });
    }
  }
  debug('subscription message - %j %j', err, data);
};

/**
 * Subscribe to the playlist and emit changes as they occur 
 *
 * @api private
 */

Playlist.prototype._subscribeToChanges = function() {
  debug('Playlist[uri=%s]#_subscribeToChanges()', this._uri);
  var self = this;
  var spotify = this._spotify;

  // update the playlist (get changes from last revision) so that we are in sync before starting
  debug('updating playlist %s', this._uri);
  this.update(function() {

    // subscribe to playlist modifications
    debug('subscrbing to playlist %s', this._uri);
    self.subscribe(self._onPlaylistModification.bind(self), function(err, resp) {
      if (err) {
        debug('subscription to playlist failed: %j', err)
      } else {
        debug('subscription successful: %j', resp);
        self._subscribed = true;
      }
    });
  });
};

/**
 * Processes the operations and applies them to the Playlist instance
 *
 * @param {Array} ops The list of operations to apply
 * @param {String|Buffer} revision Revision to change after applying changes
 * @api private
 */
Playlist.prototype._processOps = function(ops, revision) {
  // always perform modifications on the original object
  if (this.__proto__ instanceof Playlist) return this.__proto__._processOps(ops, revision);

  debug('Playlist[uri=%s]#_processOps(%j, %j)', this._uri, ops, revision);
  if (!this._data) {
    debug('aborting processOps - no data saved');
    return;
  }

  var self = this;
  ops.forEach(function(op) {
    switch(op.kind) {
      case 'UPDATE_LIST_ATTRIBUTES':
        extend(self._data.attributes, op.updateListAttributes.newAttributes.values);
        break; 
      default:
        debug('%s op not implemented - %j', op.kind, op);
        break;
    }
  });
  if (revision instanceof Buffer)
    revision = util.revision2string(revision);
  this._revision = revision;
};

/**
 * Creates a "proxy object" of the current playlist object with the contents set statically
 * This is used to ensure that the contents returned by a playlist object retrieved from a get request
 * will not change from subsequent requests to the same object. 
 *
 * @param {Object} contents
 * @api private
 */

Playlist.prototype._proxyObj = function(contents) {
  var origObj = (this.__proto__ instanceof Playlist) ? this.__proto__ : this;
  var proxyObj = Object.create(origObj, {
    _staticContents: {
      writable: false, 
      configurable: true,
      enumerable: true,
      value: contents
    }
  });
  return proxyObj;
};

/**
 * Subscribe to modifications of this Playlist instance
 *
 * @param {Function} listener (optional) callback function called when changes occur
 * @param {Function} fn (optional) callback function called when subscription created
 * @api public
 */

Playlist.prototype.subscribe = function(listener, fn) {
  debug('Playlist[uri=%s]#subscribe()', this._uri);

  var spotify = this._spotify;
  var hm = this._hmuri;

  // if we are a rootlist, don't subscribe to the rootlist url but the user's url instead
  if (this._isRootlist) {
    hm = hm.replace(/\/rootlist\/?$/,'');
  }

  // ensure mercury uri ends with a trailing slash
  if (hm.substr(-1) != '/') {
    hm += '/';
  }

  // save the callback
  spotify.addSubscriptionCallback(hm, function(err, args) {
    if (err) return listener(err);
    if (args.length < 3) return listener(new Error('not enough arguments'));
    var data = spotify._parse(PlaylistModificationInfo, new Buffer(args[2], 'base64'));
    listener(null, data);
  });

  // send the SubscribeRequest
  spotify.sendProtobufRequest({
    header: {
      method: 'SUB',
      uri: 'hm://playlist/'
    },
    payload: {
      uris: [hm]
    },
    payloadSchema: SubscribeRequest,
    responseSchema: Subscription
  }, fn);
};

/**
 * Loads all changes to this Playlist instance since it was last updated. 
 *
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.update = function(fn) {
  // always perform modifications on the original object
  if (this.__proto__ instanceof Playlist) return this.__proto__.update(fn);

  debug('Playlist[uri=%s]#update()', this._uri);

  var hm = this._hmuri + '?revision=' + this._revision;
  var self = this;
  var spotify = this._spotify;
  spotify.sendProtobufRequest({
    header: {
      method: 'DIFF',
      uri: hm
    },
    responseSchema: SelectedListContent
  }, function(err, data) {
    if (err) return fn(err);
    if (!data.diff) return fn(new Error("Did not get diff in response"));

    debug('processing diff: %j', data.diff);
    self._processOps(data.diff.ops, data.diff.toRevision);

    fn(null, data.diff.ops);
  });
};

/**
 * Loads all the metadata and requested tracks for this Playlist instance. 
 * Useful for when you get an only partially filled Playlist instance, or if you 
 * want only a certain number of tracks.
 *
 * @param {Number} from (optional) the start index. defaults to 0.
 * @param {Number} length (optional) number of tracks to get. defaults to get all available tracks by loading 100 tracks at a time.
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.get =
Playlist.prototype.metadata = function (from, length, fn) {
  // always perform modifications on the original object
  if (this.__proto__ instanceof Playlist) return this.__proto__.get(from, length, fn);

  var recursive = false;

  // argument surgery
  if ('function' == typeof from) {
    fn = from;
    from = length = null;
  } else if ('function' == typeof length) {
    fn = length;
    length = null;
  }
  if (null == from) from = 0;
  if (null == length) {
    length = 100;
    recursive = true;
  }

  debug('Playlist[uri=%s]#get(%j, %j, %j)', this._uri, from, length, recursive);

  // try and reuse contents from cache
  // TODO: move cache to spotify object so that it can be shared across multiple instances of the same url
  // e.g. the rootlist object OR cache objects and return the same instance when asked for the same url
  for (var i = 0, l = this._contents.length; i < l; i++) {
    var contents = this._contents[i];
    if (contents.from > from) continue;

    var offset = from - contents.from;

    if (recursive) {
      debug('recursive cache check - truncated=%j', contents.contents.truncated);
      if (contents.contents.truncated) continue;
      var truncated = false;
      var items = contents.contents.items.slice(offset);
    } else {

      var effectiveLength = contents.from + contents.length - from;
      if (length > effectiveLength) continue;
      
      var wantedEnd = offset + length;
      var items = contents.contents.items.slice(offset, wantedEnd);
      var truncated = (length < effectiveLength);
      debug('doing non-recursive calc, wantedEnd=%d', wantedEnd);
    }
    var contents = {
      pos: from,
      truncated: truncated,
      items: items
    };
    debug('using playlist contents from internal cache: pos=%d, truncated=%j, items: length=%d', from, truncated, items.length);
    var proxyObj = this._proxyObj(contents);
    return fn(null, proxyObj);
  }

  // make request for the data
  var hm = this._hmuri + '?from=' + from + '&length=' + length;
  var self = this;
  var spotify = this._spotify;
  spotify.sendProtobufRequest({
    header: {
      method: 'GET',
      uri: hm
    },
    responseSchema: SelectedListContent
  }, function(err, data) {
    if (err) return fn(err);

    self._revision = util.revision2string(data.revision);
    self._data = data;

    // remove old contents data (where the revision is no longer current)
    var i = self._contents.length;
    while(i--) {
      var contents = self._contents[i];
      if (contents.revision != self._revision)
        self._contents.splice(i, 1);
    };

    // update length with the actual length we got back
    length = data.contents.items.length;

    // scan for overlapping cache entries and merge them
    var merged = false;
    for (var i = 0, l = self._contents.length; i < l; i++) {
      var contents = self._contents[i];
      //      | ... new ... |
      //  | ... old ... |
      if (from >= contents.from && (contents.from + contents.length) < (from + length)) {
        debug('merging response with cache entry - type 1')
        contents.contents.truncated = data.contents.truncated;
        contents.contents.items = contents.contents.items.concat(data.contents.items.slice(contents.from + contents.length - from)); 
        contents.length = (from - contents.from) + length;
        merged = true;
        break;
      }
      // | ... new ... | 
      //           | ... old ... |
      if ((from + length) >= contents.from && from < contents.from) {
        debug('merging response with cache entry - type 2')
        contents.length = (contents.from + contents.length) - from;
        var newItems = data.contents.items.slice(0, contents.from - from);
        newItems.concat(contents.contents.items);
        contents.contents.items = newItems;
        contents.from = from;
        contents.contents.pos = from;
        merged = true;
        break;
      }
    }

    if (!merged) {
      // add new contents to array cache
      self._contents.push({
        from: from,
        length: length,
        contents: data.contents,
        revision: self._revision
      });
    }

    if (recursive && data.contents.truncated) {
      debug('recursing...');
      // get the next 100 tracks recursively
      // when successful, we then ask for all the tracks from where we originally started at (which should now be in cache)
      self.get(from + length, function(err, result){
        debug('finished. (from = %d, length = %d)', from+length, length);
        self.get(from, function(err, result){
          debug('finished2. (from = %d, length = %d)', from, length);
          fn(err, result);
        })
        
      });
    } else if ('function' == typeof fn) {
      // return a proxy object of ourselves so that the contents will remain static/correct
      // upon successive calls to get()
      fn(null, self._proxyObj(data.contents));
    }
  });
};

/**
 * Add an item to the playlist
 *
 * @param {Array|String} itemUri the uri(s) of the item to add
 * @param {Boolean} addFirst add the item to the start instead of the end
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.add = function(itemUri, addFirst, fn) {
  // argument surgery
  if ('function' == typeof addFirst) {
    fn = addFirst;
    addFirst = false;
  }
  if (!Array.isArray(itemUri)) {
    itemUri = [ itemUri ];
  }

  debug('Playlist[uri=%s]#add(%j, %j)', this._uri, itemUri, addFirst);

  var self = this;
  var spotify = this._spotify;
  var hm = this._hmuri;

  // populate the list of item objects to add
  var addItems = [];
  itemUri.forEach(function(uri) {
    var item = {};
    if ('string' == typeof uri) {
      item.uri = uri;
    } else {
      item.uri = uri.uri;
      item.attributes = uri.attributes;
    }
    addItems.push(item);
  });

  // rootlist does not allow MODIFY requests, so we need to use a ADD request instead
  if (this._isRootlist) {
    var len = addItems.length;
    debug('adding %d items to rootlist', addItems.length);
    if (addFirst) {
      hm += '?add_first=true';
    }

    var itemsAdded = 0;

    try {
      // send a separate request for each item
      addItems.forEach(function(item) {
        debug('adding %s to rootlist...', item.uri);
        spotify.sendProtobufRequest({
          header: {
            method: 'ADD',
            uri: hm
          },
          payload: item.uri,
          payloadSchema: null,
          responseSchema: null
        }, function(err, res) {
          // throw an error to abort if an error occurs
          if (err) throw err;

          // extract the revision from the response
          var revision = util.revision2string(res);
          debug('rootlist revision = %j', revision);

          // apply the operation locally
          self._processOps([{
            kind: 'ADD',
            add: {
              addLast: !addFirst,
              items: [{
                uri: item.uri
              }]
            }
          }], revision);

          itemsAdded++;
          debug('%d/%d items added to rootlist', itemsAdded, len);
          if (itemsAdded == len) {
            fn(null, self);
          }
        });
      });
    } catch(err) {
      fn(err);
    }
  } else {
    debug('adding %d items to playlist', addItems.length);

    // create the operation 
    var ops = [{
      kind: 'ADD',
      add: {
        addLast: !addFirst,
        items: addItems
      }
    }];

    // send the request, then apply the operation locally if successful
    spotify.sendProtobufRequest({
      header: {
        method: 'MODIFY',
        uri: hm
      },
      payload: {
        ops: ops
      },
      payloadSchema: OpList,
      responseSchema: ModifyReply
    }, function(err, res) {
      if (err) return fn(err);

      self._processOps(ops, res.revision);
      
      fn(null, self);
    });
  }
};

/**
 * Remove an item from a playlist
 *
 * @param {String} removeItem the uri of the item(s) to remove
 * @param {Boolean} fetchData (optional) attempt to fetch playlist data if not found in cache, defaults to true
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.remove = function(removeItem, fetchData, fn) {
  // argument surgery
  if ('function' == typeof fetchData) {
    fn = fetchData;
    fetchData = true;
  }

  debug('Playlist[uri=%s]#remove(%j, %j)', this._uri, removeItem, fetchData);

  // TODO: support removing an array of items

  // check in cached contents
  for (var i = 0; i < this._contents.length; i++) {
    var contents = this._contents[i];
    for (var j = 0; j < contents.contents.items.length; j++) {
      var item = contents.contents.items[j];
      if (item.uri == removeItem) {
        this.removeAt(contents.from + j, 1, fn);
        return;
      }
    }
  }

  // fetch data in case we have no data, then try again
  if (fetchData) {
    var self = this;
    this.get(function(err, obj) {
      self.remove(removeItem, false, fn);
    });
    return;
  }

  // give up
  fn(new Error(removeItem + " could not be found in the playlist"));
};

/**
 * Removes an item from the Playlist at the specified position
 *
 * @param {Number} fromIndex the zero-based index in the playlist to start removing items from
 * @param {Number} length the number of items to remove from the playlist from the fromIndex
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.removeAt = function(fromIndex, length, fn) {
  debug('Playlist[uri=%s]#removeAt(%j, %j)', this._uri, fromIndex, length);

  // argument validation
  if ('number' != typeof fromIndex || 'number' != typeof length || fromIndex < 0 || length < 1)
    throw new Error('fromIndex and length must be specified');

  var self = this;
  var spotify = this._spotify;

  var ops = [{
    kind: 'REM',
    rem: {
      fromIndex: fromIndex,
      length: length
    }
  }];

  var hm = this._hmuri + '?syncpublished=true&revision=' + this._revision;
  spotify.sendProtobufRequest({
    header: {
      method: 'MODIFY',
      uri: hm
    },
    payload: {
      ops: ops
    },
    payloadSchema: OpList,
    responseSchema: ModifyReply
  }, function(err, res) {
    if (err) return fn(err);

    self._processOps(ops, res.revision);

    fn(null, self);
  });
};

/**
 * Modifies the attributes of the Playlist
 *
 * @param {Object} attrs playlist attributes
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.modify = function(attrs, fn) {
  debug('Playlist[uri=%s]#modify(%j)', this._uri, attrs);

  var self = this;
  var spotify = this._spotify;
  var hm = this._hmuri + '?syncpublished=true';

  var attrValues = {};
  if (attrs.hasOwnProperty('name'))
    attrValues.name = attrs.name;
  if (attrs.hasOwnProperty('deletedByOwner'))
    attrValues.deletedByOwner = attrs.deletedByOwner;
  // TODO: Other attributes

  var updateAttrsOp = {
    kind: 'UPDATE_LIST_ATTRIBUTES',
    updateListAttributes: {
      newAttributes: {
        values: attrValues
      }
    }
  };

  var args = {
    header: {
      method: 'MODIFY',
      uri: hm
    },
    payload: {
      ops: [updateAttrsOp]
    },
    payloadSchema: OpList,
    responseSchema: ModifyReply
  };
  spotify.sendProtobufRequest(args, function(err, res) {
    if (err) return fn(err);
  
    self._processOps([updateAttrsOp], res.revision);

    fn(null, self);
  });
};

/**
 * Deletes the Playlist represented by the Playlist instance.
 *
 * A Playlist is never actually deleted, only removed from the user's rootlist.
 * If the user owns the playlist, it also sets the deletedByOwner property.
 *
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.delete = function(fn) {
  debug('Playlist[uri=%s]#delete()', this._uri);
  
  var parts = this._uri.split(':');
  var user = parts[2];

  var self = this;
  var spotify = this._spotify;

  var rootlist = new Playlist(spotify, 'spotify:user:' + spotify.username + ':rootlist');
  rootlist.remove(this._uri, function(err, res) {
    if (err) return fn(err);

    debug('modified rootlist - revision = %j', res.revision);

    // if the user owns the playlist, also mark it as deleted
    if (user == spotify.username) {
      debug('marking playlist as deletedByOwner');
      self.modify({ deletedByOwner: true }, function(err, res) {
        if (err) return fn(err);
        fn(null);
      });
    } else {
      fn(null);
    } 
  });
};