
/**
 * Module dependencies.
 */

var SpotifyUri = require('./uri');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('spotify-web:util');

/**
 * Export all the namespaces of the object passed in on to `this`
 */

exports.recursiveExport = function(object) {
  exports.export(this, object);
  if (object['$exports'])
    object['$exports'].forEach(function($export) {
      exports.recursiveExport.call(this, object[$export]);
    }, this)
};

/**
 * Export namespaces decorator
 *
 * Inspired by AngularJS DI, but is in no way compatible and does not use the same syntax
 *
 * As this method adds properties to the object's prototype, it must be called *after* any
 * modifications to the prototype object, such as is done by util.inherits
 * 
 * @param {Object} object Object to decorate
 * @param {Array|Function} namespaces Namespace objects to export
 * @api private
 */
exports.export = function(object, namespaces) {
  var objectName = object.name;
  
  // support explict naming
  if (Array.isArray(object)) {
    objectName = object[0];
    object = object[1];
  }

  if (!Array.isArray(namespaces))
    namespaces = [namespaces];

  debug('exporting %d namespaces on %s', namespaces.length, objectName);

  if (!Array.isArray(object['$exports'])) 
    object['$exports'] = [];

  namespaces.forEach(function(namespace){
    var name = namespace.name;

    // support explict naming
    if (Array.isArray(namespace)) {
      name = namespace[0];
      namespace = namespace[1];
    }

    var privateName = '_' + name;
    
    // append to exported types
    object['$exports'].push(name);

    // static export
    object[name] = namespace;

    // dynamic export
    var argumentIndex;
    Object.defineProperty(object.prototype, name, {
      get: function() {
        if (!this[privateName]) {
          // bind the constructor
          debug('attempting bind of %s.%s()', objectName, name);
          this[privateName] = exports.bindFunction(namespace, this, objectName);
          
          // TODO(adammw): rewrite this so the call stack doesn't go crazy
          if (object['$provides']) {
            Object.keys(object['$provides']).forEach(function(providerName) {
              var providerKey = object['$provides'][providerName];
              debug('%j provides %j at %s.%s', objectName, providerName, objectName, providerKey);
              this[privateName] = exports.bindFunction(this[privateName], this[providerKey], providerName);
            }, this);
          }

          // bind any static methods that we need to bind,
          // otherwise just copy the value to the bound function
          // TODO(adammw): make this function recursive if there are objects
          // TODO(adammw): rewrite this so the call stack doesn't go crazy
          Object.keys(namespace).forEach(function(key) {
            var fn = namespace[key], match, split;
            if ('$inject' == key) return;
            if ('function' == typeof fn) {
              debug('attempting bind of %s.%s.%s()', objectName, name, key);
              fn = exports.bindFunction(fn, this, objectName);
              if (object['$provides']) {
                Object.keys(object['$provides']).forEach(function(providerName) {
                  var providerKey = object['$provides'][providerName];
                  debug('%j provides %j at %s.%s', objectName, providerName, objectName, providerKey);
                  fn = exports.bindFunction(fn, this[providerKey], providerName);
                }, this);
              }
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


/** 
 * Bind helper that sets the $inject property correctly
 *
 * @param {Function} fn the function to bind
 * @param ... arguments to bind with
 * @return {Function}
 */
exports.bind = function(fn) {
  var bindArgs = Array.prototype.slice.call(arguments, 1);
  var boundFn = Function.prototype.bind.apply(fn, bindArgs);
  if (fn.$inject && Array.isArray(fn.$inject)) {
    boundFn.$inject = fn.$inject.slice(bindArgs.length - 1);
  }
  
  debug('binding %s - bind args: %j, old $inject: %j, new $inject: %j', fn.name, bindArgs, fn.$inject, boundFn.$inject);
  return boundFn;
};

exports.checkUri = function(uriA, uriB) {
  if ('/' == uriA[uriA.length - 1]) uriA = uriA.substring(0, uriA.length - 1);
  if ('/' == uriB[uriB.length - 1]) uriB = uriB.substring(0, uriB.length - 1);
  debug('checkUri %s == %s', uriA, uriB);
  return uriA == uriB;
};

/**
 * Helper function when callbacks need to be defered until something else can be completed.
 *
 * Returns a function that accepts an error argument, if the error is defined, 
 * calls back the callback with the argument.
 *
 * If there is no error, calls back the original function with the callback as the argument.
 *
 * @param {Function} fn the function to callback with arguments on success
 * @param {Function} cb the function to callback with error argument on error
 * @returns {Function}
 */
exports.deferCallback = function(fn, cb) {
  debug('deferring callback...');
  return function(err) {
    if (err) return cb(err);
    fn(cb);
  }
};

/**
 * Coerce a function into an EventEmitter-like object
 * 
 * @param {Function} fn
 * @return {Function}
 */
exports.makeEmitter = function(fn) {
  fn.__proto__ = Object.create(fn.__proto__);
  Object.keys(EventEmitter.prototype).forEach(function(key) {
    fn.__proto__[key] = EventEmitter.prototype[key];
  });
};
