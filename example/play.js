
/**
 * Example script that retreives the specified Track through Spotify, then decodes
 * the MP3 data through node-lame, and fianally plays the decoded PCM data through
 * the speakers using node-speaker.
 */

var Spotify = require('../');
var login = require('../login');
var lame = require('lame');
var Speaker = require('speaker');
var superagent = require('superagent');
var trackUri = process.argv[2] || 'spotify:track:6tdp8sdXrXlPV6AZZN2PE8';

Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;
  console.error('logged in!');

  spotify.metadata(trackUri, function (err, track) {
    if (err) throw err;
    console.error(track);
    console.error(track.album.cover);

    spotify.trackUri(track, function (err, res) {
      if (err) throw err;
      console.error(res);

      // no need to be connected to Spotify any longer...
      spotify.disconnect();

      var decoder = new lame.Decoder();
      decoder.on('format', function (format) {
        decoder.pipe(new Speaker(format));
      });
      superagent.get(res.uri).pipe(decoder);
    });
  });
});
