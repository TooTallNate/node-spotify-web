
/**
 * Module dependencies.
 */

var crypto = require("crypto");
var util = require('./util');
var inherits = require('util').inherits;
var Transform = require('stream').Transform;
var debug = require('debug')('spotify-web:crypto');

/**
 * Generates stream key based off `album_art` result.
 **/

exports.generateStreamKey = function(songKey) {
    var param1 = util.hex2bin(songKey);
    
    var swfKey = util.hex2bin("ed02752011affd6290ea42cf73fe0b99");
    
    var keys = ["8cb926e087917795914a339035fa3bc6",
                "a3285211c9d1f2364e4237c7b47cc71d",
                "72ed1f6317d1923b94ebfd8a3d867c97"];
    
    var finalKey = param1.slice(-16);
    
    for(var i=0,j=0;i<keys.length;i+=1,j+=32) {
        var msg = param1.slice(j, j+16);
        var correctHmac = param1.slice(j+16, j+32);
        var checkHmac = crypto.createHmac("sha1", util.hex2bin(keys[i]))
                              .update(msg)
                              .digest("binary");
        
        if (checkHmac.indexOf(correctHmac) == 0) {
            var finalHmac = crypto.createHmac("sha1", swfKey)
                                  .update(msg)
                                  .digest("binary");
            
            var result = "";
            for(var k=0;k<finalKey.length;k+=1)
                result += String.fromCharCode(finalHmac[k].charCodeAt(0) ^ finalKey[k].charCodeAt(0));
            return util.bin2hex(result);
        }
    }
}

/**
 * Stream decrypts encrypted MP3_160_ENC files
 *
 * @param {String} songKey   song key given in `trackUri` result
 **/

exports.EncryptedStream = function(songKey, opts) {
    if (!(this instanceof exports.EncryptedStream)) {
        return new exports.EncryptedStream(songKey, opts);
    }
    
    if (!opts) opts = {};
    opts.objectMode = true;
    Transform.call(this, opts);
    
    // required for RC4
    this.box = [];
    this.x = 0;
    this.y = 0;
    
    var key = util.hex2bin(exports.generateStreamKey(songKey));
    
    debug("key(%j)", exports.generateStreamKey(songKey));
    
    // initialize scheduling
    for(var i=0;i<256;i+=1)
        this.box[i] = i;
    
    this.x = 0;
    for(var i=0;i<256;i+=1) {
        this.x = (this.x +
                  this.box[i] +
                  key.charCodeAt(i % key.length)) % 256;
        
        var t = this.box[this.x];
        this.box[this.x] = this.box[i];
        this.box[i] = t;
    }
    
    // play 4096 pick-up
    this.x = 0;
    this.y = 0;
    for(var i=0;i<4096;i+=1) {
        this.x = (this.x + 1) % 256;
        this.y = (this.y + this.box[this.x]) % 256;
        
        var t = this.box[this.x];
        this.box[this.x] = this.box[this.y];
        this.box[this.y] = t;
    }
    
    debug([this.x, this.y, this.box]);
}
inherits(exports.EncryptedStream, Transform);

exports.EncryptedStream.prototype._transform = function _transform(obj, encoding, callback) {
    try {
        debug("_transform(%j)", obj.length);
        
        var res = new Buffer(obj.length);
        for(var i=0;i<obj.length;i+=1) {
            this.x = (this.x + 1) % 256;
            this.y = (this.y + this.box[this.x]) % 256;
            
            var t = this.box[this.x];
            this.box[this.x] = this.box[this.y];
            this.box[this.y] = t;
            
            res[i] = obj[i] ^ this.box[(this.box[this.x] + this.box[this.y]) % 256];
        }
        
        this.push(res);
        callback();
    } catch(e) {
        callback(e);
    }
}
