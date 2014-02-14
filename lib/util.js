
/**
 * Module dependencies.
 */

var base62 = require('./base62');

/**
 * Converts a GID Buffer to an ID hex string.
 * Based off of Spotify.Utils.str2hex(), modified to work with Buffers.
 */

exports.gid2id = function (gid) {
  for (var b = '', c = 0, a = gid.length; c < a; ++c) {
    b += (gid[c] + 256).toString(16).slice(-2);
  }
  return b;
};

/**
 * ID -> URI
 */

exports.id2uri = function (uriType, v) {
  var id = base62.fromHex(v, 22);
  return 'spotify:' + uriType + ':' + id;
};

/**
 * URI -> ID
 *
 * >>> SpotifyUtil.uri2id('spotify:track:6tdp8sdXrXlPV6AZZN2PE8')
 * 'd49fcea60d1f450691669b67af3bda24'
 * >>> SpotifyUtil.uri2id('spotify:user:tootallnate:playlist:0Lt5S4hGarhtZmtz7BNTeX')
 * '192803a20370c0995f271891a32da6a3'
 */

exports.uri2id = function (uri) {
  var parts = uri.split(':');
  var s;
  if (parts.length > 3 && 'playlist' == parts[3]) {
    s = parts[4];
  } else {
    s = parts[2];
  }
  var v = base62.toHex(s);
  return v;
};

/**
 * GID -> URI
 */

exports.gid2uri = function (uriType, gid) {
  var id = exports.gid2id(gid);
  return exports.id2uri(uriType, id);
};

/**
 * Accepts a String URI, returns the "type" of URI.
 * i.e. one of "local", "playlist", "track", etc.
 */

exports.uriType = function (uri) {
  var parts = uri.split(':');
  var len = parts.length;
  if (len >= 3 && 'local' == parts[1]) {
    return 'local';
  } else if (len >= 5) {
    return parts[3];
  } else if (len >= 4 && 'starred' == parts[3]) {
    return 'playlist';
  } else if (len >= 3) {
    return parts[1];
  } else {
    throw new Error('could not determine "type" for URI: ' + uri);
  }
};

/**
 * Export namespaces decorator
 *
 * Inspired by AngularJS DI
 * @api private
 */
exports.export = function(object, namespaces) {
  var objectName = object.name;
  
  // support explict naming
  if (Array.isArray(object)) {
    objectName = object[0];
    object = object[1];
  }

  debug('exporting %d namespaces on %s', namespaces.length, objectName);

  var privateName = '_' + objectName;

  namespaces.forEach(function(namespace){
    var name = namespace.name;

    // support explict naming
    if (Array.isArray(namespace)) {
      name = namespace[0];
      namespace = namespace[1];
    }

    // static export
    object[name] = namespace;

    // dynamic export
    var argumentIndex;
    Object.defineProperty(object.prototype, name, {
      get: function() {
        debug('get(%j)', name);
        if (!this[privateName]) {
          // bind the constructor
          debug('attempting bind of %s.%s()', objectName, name);
          this[privateName] = exports.bindFunction(namespace, this, objectName);

          // bind any static methods that we need to bind,
          // otherwise just copy the value to the bound function
          // TODO(adammw): make this function recursive if there are objects
          Object.keys(namespace).forEach(function(key) {
            var fn = namespace[key], match, split;
            if ('$inject' == key) return;
            if ('function' == typeof fn) {
              debug('attempting bind of %s.%s.%s()', objectName, name, key);
              fn = exports.bindFunction(fn, this, objectName);
            }
            this[privateName][key] = fn;
          }, this);
        }
        return this[privateName];
      },
      enumerable: true,
      configurable: true
    });
  });
};

/**
 * Bind a function to an object using the function's $inject array
 *
 * @param {Function} fn Function to be bound
 * @param {Object} object Object that the function will be bound to
 * @param {String} name The Object's name, used to search $inject
 * @return {Function}
 * @api private
 */
exports.bindFunction = function(fn, object, name) {
  debug('injection arguments are: %j', fn.$inject);

  // no arguments - abort
  if (!fn.$inject || !Array.isArray(fn.$inject) || !fn.$inject.length) return fn;

  // search for the argument we can provide
  argumentIndex = fn.$inject.indexOf(name);

  // if it isn't there - abort
  if (-1 === argumentIndex) return fn;

  // if it's the first argument, use Function.prototype.bind
  // and modify the arguments on the bound fn
  debug('binding instance to first argument of fn using Function.prototype.bind');
  if (0 === argumentIndex) {
    var ret = fn.bind(null, object);
    ret.$inject = fn.$inject.slice(1);
    return ret;
  }

  // otherwise, it's not the first argument, and we need to do bind ourselves
  debug('binding instance to argument %d of fn using bound_fn', argumentIndex);
  var ret = function bound_fn(){
    var args = Array.prototype.slice.call(arguments, 0);
    args.splice(argumentIndex, 0, object);
    fn.apply(null, args);
  };
  ret.$inject = fn.$inject.slice(0);
  ret.$inject.splice(argumentIndex, 1);
  return ret;
};

/**
 * Wrap a callback and handle the arity check
 * 
 * @param {Function} fn
 * @param {Object} self (this context)
 * @return {Function}
 */

exports.wrapCallback = function (fn, self) {
  if (!self) self = this;
  if ('function' == typeof fn && 2 == fn.length) return fn;
  return function(err, res) {
    if (err) return self.emit('error', err);
    if ('function' == typeof fn) fn(res);
  };
};

