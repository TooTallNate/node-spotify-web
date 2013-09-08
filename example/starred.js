
/**
 * Gets a `Playlist` instance based off of your starred songs.
 */

var Spotify = require('../');
var login = require('../login');

// initiate the Spotify session
Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;

  spotify.starred(function (err, playlist) {
    if (err) throw err;

    console.log(playlist.contents);

    spotify.disconnect();
  });
});
