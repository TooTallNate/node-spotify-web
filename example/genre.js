
/**
 * Print out the "genre" of a Track.
 *
 * This is a good example because it shows how to "load" all the metadata
 * for the `artist` field of the Track instance by calling `track.artist.get()`.
 */

var Spotify = require('../');
var login = require('../login');

var uri = process.argv[2] || 'spotify:track:1MjeP8lwmaNGqGbmS9IrEc';

// initiate the Spotify session
Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;

  // first get a "Track" instance from the track URI
  spotify.get(uri, function (err, track) {
    if (err) throw err;
    track.artist[0].get(function (err, artist) {
      console.log(artist.genre);
      spotify.disconnect();
    });
  });
});
