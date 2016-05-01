
/**
 * Module dependencies.
 */

var fs = require('fs');
var path = require('path');
var debug = require('debug')('spotify-web:schemas');

var protobufjs = require('protobufjs');

/**
 * Protocol Buffer schemas.
 */

var library = 'protobufjs';

var protoPath = path.resolve(__dirname, '..', 'proto');

var packageMapping = {
  bartender: 'bartender',
  mercury: 'mercury',
  metadata: 'metadata',
  playlist4: "playlist4changes,playlist4content,playlist4issues,playlist4meta,playlist4ops,playlist4service".split(","),
  pubsub: 'pubsub',
  toplist: 'toplist'
};
var packageCache = module.exports = {};

var loadPackage = function(id) {
  // Use cached packages
  if (packageCache.hasOwnProperty(id)) {
    debug('loadPackage(%j) [%s, cached]', id, library);
    return packageCache[id];
  } else {
    debug('loadPackage(%j) [%s]', id, library);
  }

  // Load the mapping of packages to proto files
  var mapping = packageMapping[id];
  if (!mapping) {
    debug('No mapping for %s, assuming single proto file', id)
    mapping = id;
  }
  if (!Array.isArray(mapping)) mapping = [mapping];

  // Generate a proto string with import statements
  var proto = mapping.map(function(schema) {
    return 'import "' + schema + '.proto";';
  }).join('\n');

  // Load the generated import file, and return the built package
  var builder = protobufjs.protoFromString(proto, new protobufjs.Builder(), {root: protoPath, file: id+'_generated_import.proto'});
  packageCache[id] = builder.build("spotify." + id + ".proto");
  return packageCache[id];
};

var loadMessage = module.exports.build = function(packageId, messageId) {
  debug('loadMessage(%j, %j) [%s]', packageId, messageId, library);
  
  var packageObj = loadPackage(packageId);
  var messageObj = null;
  
  // Load the message directly
  messageObj = packageObj[messageId];

  // Add wrapper functions
  messageObj.parse = function protobufjs_parse_wrapper() {
    debug('protobufjs_parse_wrapper(%j)', arguments);

    // Call the message object decode function with the arguments
    var message = messageObj.decode.apply(null, arguments);
    // Convert the object keys to camel case, ByteBuffers to Node Buffers and then return the parsed object
    return convertByteBuffersToNodeBuffers(reCamelCase(message));
  }
  messageObj.serialize = function protobufjs_serialize_wrapper() {
    debug('protobufjs_serialize_wrapper(%j)', arguments);

    // Convert any camel cased properties in the arguments to underscored properties
    Array.prototype.map.call(arguments, function (argument) {
      return deCamelCase(argument);
    });

    // Call the message object constructor with the modified arguments
    var message = Object.create(messageObj.prototype);
    message = messageObj.apply(message, arguments) || message;

    // Return the node Buffer object containing the serialised data
    return message.encodeNB();
  };

  return messageObj;
};

var deCamelCase = function(obj) {
  if (obj === null || 'object' != typeof obj) return obj;
  Object.keys(obj).forEach(function(old_key) {
    var new_key = old_key.replace(/([A-Z])/g, function($1){return "_"+$1.toLowerCase();});
    obj[new_key] = deCamelCase(obj[old_key]);
    if (new_key != old_key) delete obj[old_key];
  });
  return obj;
};

var reCamelCase = function(obj) {
  if (obj === null || 'object' != typeof obj) return obj;
  Object.keys(obj).forEach(function(old_key) {
    var new_key = old_key.replace(/(\_[a-z])/g, function($1){return $1.toUpperCase().replace('_','');});
    obj[new_key] = reCamelCase(obj[old_key]);
    if (new_key != old_key) delete obj[old_key];
  });
  return obj;
};

var convertByteBuffersToNodeBuffers = function(obj) {
  if (obj === null || 'object' != typeof obj) return obj;
  Object.keys(obj).forEach(function(key) {
    // attempt to detect a bytebuffer object
    if (obj[key] && obj[key].hasOwnProperty('array') && obj[key].hasOwnProperty('view')) {
      obj[key] = obj[key].toBuffer();
    } else {
      obj[key] = convertByteBuffersToNodeBuffers(obj[key]);
    }
  });
  return obj;
};
