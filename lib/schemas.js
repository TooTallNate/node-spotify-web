
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
exports.mercury = ProtoBuf.protoFromFile(path.resolve(proto, 'mercury.proto'), null, builder);

// metadata.proto
exports.metadata = ProtoBuf.protoFromFile(path.resolve(proto, 'metadata.proto'), null, builder);

// playlist4meta.proto
exports.playlist4meta = ProtoBuf.protoFromFile(path.resolve(proto, 'playlist4meta.proto'), null, builder);

// playlist4issues.proto
exports.playlist4issues = ProtoBuf.protoFromFile(path.resolve(proto, 'playlist4issues.proto'), null, builder);

// playlist4opts.proto
exports.playlist4ops = ProtoBuf.protoFromFile(path.resolve(proto, 'playlist4ops.proto'), null, builder);

// playlist4content.proto
exports.playlist4content = ProtoBuf.protoFromFile(path.resolve(proto, 'playlist4content.proto'), null, builder);

// playlist4changes.proto
exports.playlist4changes = ProtoBuf.protoFromFile(path.resolve(proto, 'playlist4changes.proto'), null, builder);

// toplist.proto
exports.toplist = ProtoBuf.protoFromFile(path.resolve(proto, 'toplist.proto'), null, builder);
