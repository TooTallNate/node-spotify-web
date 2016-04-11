
/**
 * Example script that retrieves the specified Track through Spotify, then decodes
 * the MP3 data through node-lame, and fianally plays the decoded PCM data through
 * the speakers using node-speaker.
 */

var Spotify = require('../');
var Login = require('../login');
var lame = require('lame');
var Speaker = require('speaker');
// determine the URI to play, ensure it's a "track" URI
var uri = process.argv[2] || 'spotify:track:3msXQay9Cm00BanvO7eGsm';

var spotify,				//The spotify instance
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
	networkErrorCount = 0; //The amount of times the network error has occured
//This function is here as the network error requires us to login again to be able to get the track URI.
function login(onLoginCallback){
	if(spotify !== undefined && !Spotify.connected) spotify.disconnect();
	Spotify.login(Login.username, Login.password, function (err, spotifyObj) {
		spotify = spotifyObj;
		if (err) throw err;
		onLoginCallback(err, spotify);
	});
}
//Allow us to play the track with our controlled environment
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
			finish 			occurs when the track has finished playing
		*/
		stream
		.on('region-error', function(err){
		  console.log(err.message + "\n\nExited.");
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
		.on('error', function(err){
			//Let's skip songs as that track is currently unavailable
			console.log("The track is currently unavailable\nReason\n%s", err.message);
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
		.pipe(speaker)
		.on('finish', function () {
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
		});
		speaker.on('open', function(){
			console.log("Playing track...");
		})
	});
}

login(function(){
	play(uri, function(){
		spotify.disconnect();
		console.log("Finished.");
		process.exit(0);
	});
});




