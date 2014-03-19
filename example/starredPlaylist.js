
/**
 * Gets a user's starred playlist (array of track URI's).
 */

var Spotify = require('../');
var login = require('../login');

// determine which Users starred Playlist to select
var user = process.argv[2] || login.username;

// initiate the Spotify session
Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;

  // get the selected user's rootlist (playlist names)
  spotify.starred( user , function (err, starred) {
    if (err) throw err;

    console.log(starred.contents);

    spotify.disconnect();
  });
});
