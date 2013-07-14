
/**
 * Module dependencies.
 */

var fs = require('fs');
var path = require('path');
var ProtoBuf = require('protobufjs');

/**
 * Protocol Buffer schemas.
 */

var proto = path.resolve(__dirname, '..', 'proto');
var builder = new ProtoBuf.Builder;

// mercury.proto
ProtoBuf.protoFromFile(path.resolve(proto, 'mercury.proto'), null, builder);

// metadata.proto
ProtoBuf.protoFromFile(path.resolve(proto, 'metadata.proto'), null, builder);

// playlist4changes.proto
ProtoBuf.protoFromFile(path.resolve(proto, 'playlist4changes.proto'), null, builder);

// toplist.proto
ProtoBuf.protoFromFile(path.resolve(proto, 'toplist.proto'), null, builder);

module.exports = builder;