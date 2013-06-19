var Spotify = require('spotify-web');

// Spotify credentials...
var username = process.env.USERNAME;
var password = process.env.PASSWORD;

Spotify.login(username, password, function (err, spotify) {
	if (err) throw err;
	
	spotify.createplaylist(username, 'new playlist', function (err, ret) {
		spotify.addtrack(ret,'spotify:track:6tdp8sdXrXlPV6AZZN2PE8', function (err, ret) {
			console.log(ret);
		});				
	});	
	
});