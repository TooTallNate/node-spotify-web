
/**
 * Example script that retrieves similar tracks
 */

var Spotify = require('../');
var login = require('../login');

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
    console.log('Similar Tracks to %s - %s', track.artist[0].name, track.name);

    // request similar tracks - and display the artist and track name for each suggested track
    spotify.similar(uri, function (err, similar) {
      if (err) throw err;

      similar.stories.forEach(function(story) {
        var track = story.recommendedItem;
        var album = track.parent;
        var artist = album.parent;
        console.log(' * %s - %s [%s]', artist.displayName, track.displayName, track.uri);
      });

      spotify.disconnect();
    });
  });

});
