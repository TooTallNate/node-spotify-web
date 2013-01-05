
var Spotify = require('./');
var login = require('./login');
var trackUri = 'spotify:track:6tdp8sdXrXlPV6AZZN2PE8';

Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;
  console.log('logged in!');
  spotify.metadata(trackUri, function (err, track) {
    console.log(track);
    spotify.trackUri(track, function (err, res) {
      console.log(res);
    });
  });
});
