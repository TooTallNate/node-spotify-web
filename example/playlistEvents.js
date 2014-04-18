
/**
 * Example script that plays a playlist, with live updating of the internal queue
 * when the contents of the playlist changes
 */

var Spotify = require('../');
var login = require('../login');
var lame = require('lame');
var Speaker = require('speaker');
var uri = process.argv[2];

var onPlaylist = function(err, playlist) {
  if (err) throw err;

  var playing = false;
  var itemsToPlay = [];
  var queueOffset = 0;

  playlist.contents(function(err, contents) {
    if (err) throw err;

    // add existing playlist contents to queue
    contents.forEach(function(playlistItem) {
      itemsToPlay.push(playlistItem.item);
    });

    // handle playlist modifications
    playlist.contents.on('add', function(change) {
      change.add.items.forEach(function(playlistItem, index) {
        var item = playlistItem.item;
        var position = change.add.fromIndex + index;
        if (position < queueOffset) {
          console.log('Tracks added before current track, will not be played.');
          return;
        }
        console.log('Track added to queue: %s at position %d', item.uri, position);
        itemsToPlay.splice(position - queueOffset, 0, item);
        if (!playing) next();
      });
    });
    playlist.contents.on('rem', function(change) {
      itemsToPlay.splice(change.rem.fromIndex - queueOffset, change.rem.length);
      console.log('items:', change.rem.items);
      console.log('Tracks removed from queue: %s', change.rem.items.map(function(i) { return i.item.uri; }).join(', '));
      // TODO: handle removing current track
    });
    playlist.contents.on('mov', function(change) {
      console.log('tracks moved', change);
      var itemsToMove = itemsToPlay.splice(change.mov.fromIndex - queueOffset, change.mov.toIndex);
      if (change.mov.toIndex < queueOffset) {
        console.log('Tracks moved to before current track, will not be played.');
        return;
      }
      var args = [change.mov.toIndex - queueOffset, 0].concat(itemsToMove);
      itemsToPlay.splice.apply(itemsToPlay, args);
      console.log('Tracks moved in queue');
      // TODO: handle moving current track
    });

    // start playing or wait for tracks
    if (itemsToPlay.length) {
      console.log('Playing songs from %s.', playlist.uri);
      next();
    } else {
      console.log('Ready... Add songs to the playlist %s to start playing.', playlist.uri);
    }
  });

  var next = function() {
    var track = itemsToPlay.shift();
    if (!track) {
      console.log('End of queue');
      playing = false;
      return;
    }
    queueOffset++;
    if ('track' != track.type) {
      console.log('Skipping non-track item:', track);
      return next();
    }

    playing = true;

    console.log('Fetching: %s', track.uri);

    track.get(function(err, track) {
      if (err) {
        console.error(err.stack || err);
        return next();
      }

      console.log('Playing: %s - %s', track.artist[0].name, track.name);

      track.play()
        .on('error', function (err) {
          console.error(err.stack || err);
          next();
        })
        .pipe(new lame.Decoder())
        .pipe(new Speaker())
        .on('finish', next);
    });
  };
};

// initiate the Spotify session
Spotify.login(login.username, login.password, function (err, spotify) {
  if (err) throw err;

  // Load an existing playlist if specified, otherwise create a new one
  if (uri && uri.length) {
    var type = Spotify.uriType(uri);
    if ('playlist' != type) {
      throw new Error('Must pass a "playlist" URI, got ' + JSON.stringify(type));
    }
    spotify.Playlist.get(uri, onPlaylist);
  } else {
    spotify.Playlist.create('Test Playlist ' + (new Date().toDateString()), onPlaylist);
  }
});
