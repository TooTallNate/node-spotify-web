
/**
 * Example script that retrieves the specified Album through Spotify, then decodes
 * the MP3 data through node-lame, and fianally plays the decoded PCM data through
 * the speakers using node-speaker.
 */

var Spotify = require('../');
var login = require('../login');
var lame = require('lame');
var Speaker = require('speaker');
var superagent = require('superagent');

var uri = process.argv[2] || 'spotify:album:7u6zL7kqpgLPISZYXNTgYk';

Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;

  // first get a "Album" instance from the album URI
  spotify.metadata(uri, function (err, album) {
    if (err) throw err;

    // first get the individual track IDs
    var trackIds = [];
    album.disc.forEach(function (disc) {
      if (!Array.isArray(disc.track)) return;
      var ids = disc.track.map(function (track) { return track.gid; });
      trackIds.push.apply(trackIds, ids);
    });
    //console.log(trackIds);

    var trackUris = trackIds.map(function (id) {
      return Spotify.gid2uri('track', id);
    });
    console.log(trackUris);

    function next () {
      var uri = trackUris.shift();
      if (!uri) return spotify.disconnect();

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
              spotify.sendTrackEnd(res.lid, uri, track.duration, next);
            });
        });
      });
    }
    next();

  });
});
