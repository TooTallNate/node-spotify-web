
/**
 * Module dependencies.
 */

var util = require('./util');
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var SelectedListContent = require('./schemas').playlist4changes['spotify.playlist4.proto.SelectedListContent'];
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
 * Attributes getter.
 */

Object.defineProperty(Playlist.prototype, 'attributes', {
  get: function () {
    return this._data.attributes || null;
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
    data.diff.ops.forEach(function(op) {
      switch(op.kind) {
        case 'UPDATE_LIST_ATTRIBUTES':
          extend(self._data.attributes, op.updateListAttributes.newAttributes.values);
          break; 
        default:
          debug('%s op not implemented - %j', op.kind, op);
          break;
      }
    });
    self._revision = util.revision2string(data.diff.toRevision);

    fn(null, data.diff.ops);
  });
};

/**
 * ???
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
 * @param {Number} length (optional) number of tracks to get. defaults to 100.
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
