
/**
 * Example script that retrieves a preview of the specified Track through Spotify, 
 * then decodes the MP3 data through node-lame, and fianally plays the decoded PCM 
 * data through the speakers using node-speaker.
 */

var Spotify = require('../');
var login = require('../login');
var lame = require('lame');
var Speaker = require('speaker');

// determine the URI to play, ensure it's a "track" URI
var uri = process.argv[2] || 'spotify:track:6tdp8sdXrXlPV6AZZN2PE8';
var type = Spotify.uriType(uri);
if ('track' != type) {
  throw new Error('Must pass a "track" URI, got ' + JSON.stringify(type));
}

// initiate the Spotify session
Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;

  // first get a "Track" instance from the track URI
  spotify.get(uri, function (err, track) {
    if (err) throw err;
    console.log('Playing 30 second preview of: %s - %s', track.artist[0].name, track.name);
    var previewUrl = 'http://d318706lgtcm8e.cloudfront.net/mp3-preview/' + Spotify.gid2id(track.preview[0].fileId);
    
    var req = spotify.agent.get(previewUrl)
      .set({ 'User-Agent': spotify.userAgent })
      .end()
      .request();
    req.on('response', function(res) {
      res.pipe(new lame.Decoder())
        .pipe(new Speaker())
        .on('finish', function () {
          spotify.disconnect();
        });
    });

  });
});
