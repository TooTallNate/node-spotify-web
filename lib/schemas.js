
/**
 * Module dependencies.
 */

var fs = require('fs');
var path = require('path');
var protobuf = require("protobufjs");

/**
 * Protocol Buffer schemas.
 */

var proto = path.resolve(__dirname, '..', 'proto');

// mercury.proto
exports.mercury = ProtoBuf.protoFromFile(path.resolve(proto, 'mercury.proto'));

// metadata.proto
exports.metadata = ProtoBuf.protoFromFile(path.resolve(proto, 'metadata.proto'));

// playlist4meta.proto
exports.playlist4meta = ProtoBuf.protoFromFile(path.resolve(proto, 'playlist4meta.proto'));

// playlist4issues.proto
exports.playlist4issues = ProtoBuf.protoFromFile(path.resolve(proto, 'playlist4issues.proto'));

// playlist4opts.proto
exports.playlist4ops = ProtoBuf.protoFromFile(path.resolve(proto, 'playlist4ops.proto'));

// playlist4content.proto
exports.playlist4content = ProtoBuf.protoFromFile(path.resolve(proto, 'playlist4content.proto'));

// playlist4changes.proto
exports.playlist4changes = ProtoBuf.protoFromFile(path.resolve(proto, 'playlist4changes.proto'));

// toplist.proto
exports.toplist = ProtoBuf.protoFromFile(path.resolve(proto, 'toplist.proto'));
