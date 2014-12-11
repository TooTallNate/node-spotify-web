
1.3.0 / 2014-12-11
==================

  * spotify: update comment to explain the web service
  * spotify: use `ping-pong.spotify.nodestuff.net` web service for sendPong (#98, @denysvitali)
  * spotify: set "User-Agent" and "Origin" on WebSocket connection (#96, @denysvitali)
  * add LICENSE file
  * README: add License section
  * s/NodeJS/Node.js/
  * example: add an example of getting Artist "genre"

1.2.0 / 2014-04-26
==================

  * spotify: new flash key (#81, @brandtabbott)
  * spotify: added functionality to get a users starred playlist with example

1.1.1 / 2014-04-02
==================

  * example: switch
  * spotify: added `Spotify.Web.App.initialize()` noop Function (#76)

1.1.0 / 2014-02-24
==================

  * spotify: handle `sp/ping_flash2` commands
  * spotify: emit "open" and "close" events
  * spotify: fix lint
  * spotify: use client version from auth response

1.0.0 / 2014-01-08
==================

  * spotify: update user agent and send window size log event on connection (#60)
  * spotify: tag function bugfix
  * proto: update schemas module api, add protobufjs support
  * proto: add pubsub and playlist4service
  * proto: Update metadata protobuf with added Catalogue SHUFFLE enum
  * bugfix for multiGet
  * spotify: use http status message in error when none is defined
  * spotify: add similar(uri, fn) method
  * proto: add bartender schemas
  * track: cache previewUrl from getter in playPreview method and emit error on stream in nextTick
  * track: emit error if preview stream does not respond with 200 status code
  * spotify: fix bug which prevented facebook and anonymous login from working
  * spotify: add facebook and anonymous login
  * spotify: improve authentication and include trackingId
  * spotify: add XXX comment...
  * spotify: more robust `has()` function
  * track: emit error if stream does not respond with 200 status code
  * spotify: use correct number argument for sending SUB/UNSUB MercuryRequests
  * spotify: make callback of sendProtobufRequest optional
  * track: add previewUrl getter and playPreview method
  * example: add preview playing example
  * proto: update metadata fields
  * spotify: use SelectedListContent instead of ListDump for playlist and rootlist responseSchemas
  * spotify: refactor MercuryRequest code into sendProtobufRequest function

0.1.3 / 2013-06-16
==================

  * proto: change contentType to bytes format
  * spotify: support MercuryMultiGetRequest in `get()` function
  * util: fix comment
  * spotify: fix lint

0.1.2 / 2013-05-18
==================

  * spotify: use AP resolver to connect to websocket server (GH-13) @adammw

0.1.1 / 2013-03-22
==================

  * error: add error code for non-premium accounts

0.1.0 / 2013-03-09
==================

  * spotify: implement real error handling
  * spotify: ignore "login_complete" message commands
  * spotify: throw an error on unhandled "message" commands
  * error: add SpotifyError class
  * spotify: make rootlist() user default to yourself
  * track: send the User-Agent in .play()
  * Added `rootlist()` function to get a user's stored playlists

0.0.2 / 2013-02-07
==================

  * Fix CSRF token retrieval
  * A whole lot of API changes... too much to list...

0.0.1 / 2013-01-12
==================

  * Initial release:
    * getting Artist/Album/Track metadata works
    * getting MP3 playback URL for a Track works
