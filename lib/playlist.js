
/**
 * Module dependencies.
 */

var util = require('./util');
var schemas = require('./schemas');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var SelectedListContent = schemas.playlist4changes['spotify.playlist4.proto.SelectedListContent'];
var OpList = schemas.playlist4ops['spotify.playlist4.proto.OpList'];
var ModifyReply = schemas.playlist4service['spotify.playlist4.proto.ModifyReply'];
var debug = require('debug')('spotify-web:playlist');

/**
 * Module exports.
 */

var Playlist = exports = module.exports = function(uri, revision){
  debug('Playlist(%j)',uri)

  if (!(this instanceof Playlist)) return new Playlist(uri);
  EventEmitter.call(this);

  var self = this;
  if (uri && 'playlist' != util.uriType(uri)) {
    throw new Error('Playlist requires a playlist uri');
  }
  this._uri = uri || null;
  this._revision = revision || null;

  this._data = null;
  this._contents = [];
  this._subscribed = false;

  var spotify = this._spotify;
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
};
inherits(Playlist, EventEmitter);

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
 * hmuri getter.
 *
 * @api private
 */

Object.defineProperty(Playlist.prototype, 'hmuri', {
  get: function () {
    var parts = this._uri.split(':');
    var user = parts[2];
    var id = parts[4];
    var hm = 'hm://playlist/user/' + user + '/playlist/' + id;
    return hm;
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
    return this._data.attributes || null;
  },
  set: function(attributes) {
    this.modifyAttributes(attributes);
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
 * Subscribe to the playlist and emit changes as they occur 
 *
 * @api private
 */

Playlist.prototype._subscribeToChanges = function() {
  var self = this;
  var spotify = this._spotify;

  debug('subscrbing to playlist %s', this._uri);

  spotify.subscribe([this._uri], function(err, data) {
    if (err) return self.emit('error', err);
    if (data.newRevision) {
      var newRevision = util.revision2string(data.newRevision);
      debug('playlist "%s" updated to revision "%s"', self._uri, newRevision);
      var listeners = self.listeners('change').length;
      if (listeners) {
        debug('requesting diff - %d listeners on change event', listeners);
        self.update(function(err, ops){
          if (err) return self.emit('error', err);
          self.emit('change', ops);
        });
      }
    }
    debug('subscription message - %j %j', err, data);
  }, function(err, resp) {
    if (err) {
      debug('subscription to playlist failed: %j', err)
    } else {
      debug('subscription successful: %j', resp);
      self._subscribed = true;
    }
  })
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

  var hm = this.hmuri + '?revision=' + this._revision;
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
 * Processes the operations and applies them to the Playlist instance
 *
 * @param {Array} ops The list of operations to apply
 * @param {String|Buffer} revision Revision to change after applying changes
 * @api private
 */
Playlist.prototype._processOps = function(ops, revision) {
  debug('Playlist[uri=%s]#_processOps(%j, %j)', this._uri, ops, revision);
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
}

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
  var hm = this.hmuri + '?from=' + from + '&length=' + length;
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
    } else {
      // return a proxy object of ourselves so that the contents will remain static/correct
      // upon successive calls to get()
      fn(null, self._proxyObj(data.contents));
    }
  });
};

/**
 * Add an item to the playlist
 *
 * @param {Array|String} itemUri the uri of the item to add
 * @param {Boolean} addFirst add the item to the start instead of the end
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.addItem = 
Playlist.prototype.addItems = function(itemUri, addFirst, fn) {
  // argument surgery
  if ('function' == typeof addFirst) {
    fn = addFirst;
    addFirst = false;
  }
  if (!Array.isArray(itemUri)) {
    itemUri = [ itemUri ];
  }

  debug('Playlist[uri=%s]#addToPlaylist(%j, %j)', this._uri, itemUri, addFirst);

  var self = this;
  var spotify = this._spotify;
  var hm = this.hmuri;

  debug('adding %d items to playlist', itemUri.length);

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
};

/**
 * Remove an item from a playlist
 *
 * @param {String} removeItem the uri of the item(s) to remove
 * @param {Boolean} fetchData (optional) attempt to fetch playlist data if not found in cache, defaults to true
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.removeItem = function(removeItem, fetchData, fn) {
  // argument surgery
  if ('function' == typeof fetchData) {
    fn = fetchData;
    fetchData = true;
  }

  debug('Playlist[uri=%s]#removeItem(%j, %j)', this._uri, removeItem, fetchData);

  // TODO: support removing an array of items

  // check in cached contents
  for (var i = 0; i < this._contents.length; i++) {
    var contents = this._contents[i];
    for (var j = 0; j < contents.contents.items.length; j++) {
      var item = contents.contents.items[j];
      if (item.uri == removeItem) {
        this.removeItemAt(contents.from + j, 1, fn);
        return;
      }
    }
  }

  // fetch data in case we have no data, then try again
  if (fetchData) {
    var self = this;
    this.get(function(err, obj) {
      self.removeItem(removeItems, false, fn);
    });
    return;
  }

  // give up
  fn(new Error(removeItems + " could not be found in the playlist"));
};

/**
 * Removes an item from the Playlist at the specified position
 *
 * @param {Number} fromIndex the zero-based index in the playlist to start removing items from
 * @param {Number} length the number of items to remove from the playlist from the fromIndex
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.removeItemAt = function(fromIndex, length, fn) {
  debug('Playlist[uri=%s]#removeItemAt(%j, %j)', this._uri, fromIndex, length);

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

  var hm = this.hmuri + '?syncpublished=true&revision=' + this._revision;
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

    fn(null, playlist);
  });
};

/**
 * Modifies the attributes of the Playlist
 *
 * @param {Object} attrs playlist attributes
 * @param {Function} fn callback function
 * @api public
 */

Playlist.prototype.modifyAttributes = function(attrs, fn) {
  debug('Playlist[uri=%s]#modifyPlaylist(%j)', this._uri, attrs);

  var self = this;
  var spotify = this._spotify;
  var hm = this.hmuri + '?syncpublished=true';

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
  
  var parts = uri.split(':');
  var user = parts[2];

  var self = this;
  var spotify = this._spotify;

  spotify.removeFromRootlist(this._uri, null, function(err, res) {
    if (err) return fn(err);

    debug('modified rootlist - revision = %j', res.revision);

    // if the user owns the playlist, also mark it as deleted
    if (user == spotify.username) {
      debug('marking playlist as deletedByOwner');
      spotify.modifyPlaylist(uri, { deletedByOwner: true }, function(err, res) {
        if (err) return fn(err);
        fn(null);
      });
    } else {
      fn(null);
    }      
  });
};