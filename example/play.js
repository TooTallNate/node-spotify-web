
/**
 * Example script that retrieves the specified Track through Spotify, then decodes
 * the MP3 data through node-lame, and fianally plays the decoded PCM data through
 * the speakers using node-speaker.
 */

var Spotify = require('../');
var login = require('../login');
var lame = require('lame');
var Speaker = require('speaker');
var superagent = require('superagent');

var uri = process.argv[2] || 'spotify:track:6tdp8sdXrXlPV6AZZN2PE8';

Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;

  // first get a "track" instance from the Track URI
  spotify.metadata(uri, function (err, track) {
    if (err) throw err;

    spotify.trackUri(track, function (err, res) {
      if (err) throw err;
      console.log('Playing: %s - %s', track.artist[0].name, track.name);
      console.log('MP3 URL: %j', res.uri);

      superagent.get(res.uri)
        .pipe(new lame.Decoder())
        .pipe(new Speaker())
        .on('finish', function () {
          spotify.disconnect();
        });
    });
  });
});
