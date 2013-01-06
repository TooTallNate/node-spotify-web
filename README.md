node-spotify-web
================
### NodeJS implementation of the Spotify Web protocol

This module implements the "Spotify Web" WebSocket protocol that is used on
Spotify's [Web UI](http://play.spotify.com).

This module is heavily inspired by the original open-source Python implementation:
[Hexxeh/spotify-websocket-api](https://github.com/Hexxeh/spotify-websocket-api)

Installation
------------

``` bash
$ npm install spotify-web
```


Example
-------

Here's an example of logging in to the Spotify server and creating a session. Then
requesting the metadata for a given Track URI, and prints the playback URL for the
audio file:

``` javascript
var Spotify = require('spotify-web');
var superagent = require('superagent');
var trackUri = process.argv[2] || 'spotify:track:6tdp8sdXrXlPV6AZZN2PE8';

// Spotify credentials...
var username = process.env.USERNAME;
var username = process.env.PASSWORD;

Spotify.login(username, password, function (err, spotify) {
  if (err) throw err;

  // first get a "track" instance from the Track URI
  spotify.metadata(trackUri, function (err, track) {
    if (err) throw err;
    console.log('Playback URI for: %s - %s', track.artist[0].name, track.name);

    // next get the playback MP3 URI
    spotify.trackUri(track, function (err, res) {
      if (err) throw err;
      console.log('MP3 URL: %j', res.uri);

      // disconnect from Spotify so the program can exit
      spotify.disconnect();
    });
  });
});
```

See the `examples` directory for some more example code.


API
---

TODO: document!
