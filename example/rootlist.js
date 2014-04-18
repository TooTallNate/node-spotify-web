
/**
 * Gets the user's "rootlist" (array of playlist IDs).
 */

var Spotify = require('../');
var login = require('../login');

// initiate the Spotify session
Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;

  console.log('Rootlist for %s\n============', spotify.user.username);

  // get the currently logged in user's rootlist (playlist names)
  var rootlist = spotify.user.rootlist();

  rootlist.contents(function(err, contents) { 
    if (err) throw err;
    contents.forEach(function(item, i) {
      console.log('%d. %s', i+1, item.item.uri);
    });

    spotify.disconnect();
  });
});
