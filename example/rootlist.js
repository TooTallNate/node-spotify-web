
/**
 * Gets a user's "rootlist" (array of playlist IDs).
 */

var Spotify = require('../');
var login = require('../login');

// determine which Users rootlist to select
var user = process.argv[2] || login.username;

// initiate the Spotify session
Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;

  // get the selected user's rootlist (playlist names)
  spotify.rootlist( user, function (err, rootlist) {
    if (err) throw err;

    console.log(rootlist.contents);

    spotify.disconnect();
  });
});
