
/**
 * Example script that retrieves the specified Tracks through Spotify, then decodes
 * the MP3 data through node-lame, and fianally plays the decoded PCM data through
 * the speakers using node-speaker for ~8 seconds before beginning the next track.
 * This is the beginning of what *could* be used to create a mixtape of different
 * songs and put them together.
 * 
 * The main functionality of this file begins now. The idea behind mixtape.js is 
 * to have a list of track URI's played to test that they all work and that the
 * stream is able to stop the last track's stream. All tracks get played for ~8
 * seconds before the next one is found and played. This is to test that the 
 * connection between the client and spotify is working in the attempts to solve 
 * issue #111 - TrackError: Account subscription status not Spotify Premium
 * (https://github.com/TooTallNate/node-spotify-web/issues/111)
 */

var Spotify = require('../');
var lame = require('lame');
var Login = require('../login');
var Speaker = require('speaker');
// determine the URI to play, ensure it's a "track" URI
var uri = process.argv[2] || 'spotify:track:3msXQay9Cm00BanvO7eGsm';

var spotify,
	networkErrorActions = { //Allow us to treat the network error a few times and eventually give up.
		2: function(){
			console.log("Please wait...");
		},
		4: function(){
			console.log("This is taking longer than usual. Please wait.");
		},	
		5: function(){
			console.log("A network/protocol error prevented me getting the audio track. Trying for the last time.");
		},
		6: function(){
			console.log("Giving up...");
			process.exit(-1);
		}
	},
	networkErrorCount = 0;
function login(onLoginCallback){
	if(spotify !== undefined && !Spotify.connected) spotify.disconnect();
	Spotify.login(Login.username, Login.password, function (err, spotifyObj) {
		spotify = spotifyObj;
		if (err) throw err;
		onLoginCallback(err, spotify);
	});
}
function play(uri, onFinishCallback){
	var type = Spotify.uriType(uri);
	if ('track' != type) throw new Error('Must pass a "track" URI, got ' + JSON.stringify(type));
	spotify.get(uri, function (err, track) {
		if (err) throw err;
		//Let's try playing the stream
		var stream = track.play();
		//Let's be able to control the speakers
		var speaker = new Speaker();
		/*
			Setup of events
			region-error 	occurs when the track cannot be played in their country.
			network-error 	occurs when a network/protocol error is sent back after retrieving as track URI response.
			error 			occurs when an unknown error is preventing the track from starting, we normally skip songs in this instance.
			play-success	occurs when the track URI is retrieved and the outlook of the stream looks successful (stream any minute now).
			open 			occurs when the speaker gets its first write to be played onto the speakers
		*/
		stream
		.on('region-error', function(err){
		  console.log(err.message + "\n\nExited.") 
		  process.exit(-1); 
		})
		.on('network-error', function(err){
			if(networkErrorCount in networkErrorActions) networkErrorActions[networkErrorCount](); 
			networkErrorCount++;
			//Let's try to resolve it.
			process.nextTick(function(){
				login(function(err, spotify){
					play(uri, onFinishCallback);    
				});
			});
		})
		.on('error', function(){
			//Let's skip songs as that track is currently unavailable
			onFinishCallback();
		})
		.on('play-success', function(){
			//Reset the error count
			networkErrorCount = 0;
			console.log('Found track (%s - "%s")', track.artist[0].name, track.name);
		})
		.pipe(new lame.Decoder({
			// input
			channels: 2,        // 2 channels (left and right)
			bitDepth: 16,       // 16-bit samples
			sampleRate: 44100,  // 44,100 Hz sample rate

			// output
			bitRate: 128,
			outSampleRate: 22050,
			mode: lame.STEREO // STEREO (default), JOINTSTEREO, DUALCHANNEL or MONO
		}))
		.pipe(speaker);
		speaker.on('open', function(){
			console.log("Playing track for 8 seconds");
			setTimeout(function(){
				//Stop playing the music to the speakers, this will flush the remaining data
				speaker.close();
				//Prevent the speakers being piped to
				stream.unpipe();
				//End the stream
				stream.end();
				//Send a message that we have stopped
				spotify.sendTrackEnd(track._playSession.lid, track.uri, track.duration, function(){
					onFinishCallback();
				});
				track._playSession = null;
			}, 8000);
		})
	});
}

login(function(){
	var mixTape = [
		'spotify:track:3msXQay9Cm00BanvO7eGsm',
		"spotify:track:7D0YmNlI9FDwodlKzHraRp",
		"spotify:track:1FDNw06jT4JdYiZ2xxhuyi",
		"spotify:track:2J3JnWZCB7DzkAIeJjEjRy",
		"spotify:track:1qljrnhOuczXoit9CKfWBN",
		"spotify:track:2O3FCy9JdGflUnZ8LLrd4u",
		"spotify:track:1yWc4aC8zphMCDmwZ9Ch7K",
		"spotify:track:48td6xvpokdYwvbl3JIiXP",
		"spotify:track:35SI5zFEhOeo4XDBMwS41S"
	];
	function playTrack(i){
		if (i == mixTape.length){
			console.log("Finished");
			spotify.disconnect();
			process.exit(0);
		}
		console.log("\n\nFinding track for URI: " + mixTape[i]);
		play(mixTape[i], function(){playTrack(i+1);});
	}
	playTrack(0);
});




