
/**
 * Creates a `Playlist`
 */

var Spotify = require('../');
var login = require('../login');

// determine the track URIs to add to the playlist, ensure they are "track" URIs
var tracks = process.argv.slice(2);
if (!tracks.length)
  tracks = ['spotify:track:2Foc5Q5nqNiosCNqttzHof','spotify:track:1iNeZGJsoC0D7ZyJTdIbDS','spotify:track:0DiWol3AO6WpXZgp0goxAV','spotify:track:5W3cjX2J3tjhG8zb6u0qHn'];
tracks.forEach(function(uri) {
  var type = Spotify.uriType(uri);
  if ('track' != type) {
    throw new Error('Must pass "track" URIs, got ' + JSON.stringify(type));
  }
});

// initiate the Spotify session
Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;

  spotify.Playlist.create({ name: 'Example Playlist' }, function(err, playlist) {
    if (err) throw err;
    console.log('created playlist, ' + playlist.uri);

    // add tracks to the newly created playlist
    playlist.add(tracks, function(err, result) {
      if (err) throw err;
      console.log('all tracks added successfully');
      spotify.disconnect();
    });
  });
});