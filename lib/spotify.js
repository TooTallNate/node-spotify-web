/**
 * Module dependencies.
 */

var vm = require('vm');
var util = require('./util');
var crypto = require('./crypto');
var http = require('http');
var https = require('https');
var tls = require('tls');
var WebSocket = require('ws');
var cheerio = require('cheerio');
var schemas = require('./schemas');
var superagent = require('superagent');
var inherits = require('util').inherits;
var SpotifyError = require('./error');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('spotify-web');
var pkg = require('../package.json');

/**
 * Module exports.
 */

module.exports = Spotify;

/**
 * Protocol Buffer types.
 */

var MercuryMultiGetRequest = schemas.build('mercury','MercuryMultiGetRequest');
var MercuryMultiGetReply = schemas.build('mercury','MercuryMultiGetReply');
var MercuryRequest = schemas.build('mercury','MercuryRequest');

var Artist = require('./artist');
var Album = require('./album');
var Track = require('./track');
var Image = require('./image');
require('./restriction');

var SelectedListContent = schemas.build('playlist4','SelectedListContent');

var StoryRequest = schemas.build('bartender','StoryRequest');
var StoryList = schemas.build('bartender','StoryList');

/**
 * Re-export all the `util` functions.
 */

Object.keys(util).forEach(function (key) {
  Spotify[key] = util[key];
});

/**
 * Create instance and login convenience function.
 *
 * @param {String} un username
 * @param {String} pw password
 * @param {Function} fn callback function
 * @api public
 */

Spotify.login = function (un, pw, fn) {
  if (!fn) fn = function () {};
  var spotify = new Spotify();
  spotify.login(un, pw, function (err) {
    if (err) return fn(err);
    fn.call(spotify, null, spotify);
  });
  return spotify;
};

/**
 * Create instance and facebooklogin convenience function.
 *
 * @param {String} fbuid facebook uid
 * @param {String} token facebook token
 * @param {Function} fn callback function
 * @api public
 */

Spotify.facebookLogin = function (fbuid, token, fn) {
  if (!fn) fn = function () {};
  var spotify = new Spotify();
  spotify.facebookLogin(fbuid, token, function (err) {
    if (err) return fn(err);
    fn.call(spotify, null, spotify);
  });
  return spotify;
};

/**
 * Patched version of `https.Agent.createConnection` that disables SNI on websocket connections.
 */

function createHttpsConnection(port, host, options) {
  if (typeof port === 'object') {
    options = port;
  } else if (typeof host === 'object') {
    options = host;
  } else if (typeof options === 'object') {
    options = options;
  } else {
    options = {};
  }

  if (typeof port === 'number') {
    options.port = port;
  }

  if (typeof host === 'string') {
    options.host = host;
  }

  // Disable SNI
  options.servername = null;

  return tls.connect(options);
}

/**
 * Spotify Web base class.
 *
 * @api public
 */

function Spotify () {
  if (!(this instanceof Spotify)) return new Spotify();
  EventEmitter.call(this);

  this.seq = 0;
  this.heartbeatInterval = 18E4; // 180s, from "spotify.web.client.js"
  this.agent = superagent.agent();
  this.connected = false; // true after the WebSocket "connect" message is sent
  this._callbacks = Object.create(null);

  this.authServer = 'play.spotify.com';
  this.authUrl = '/xhr/json/auth.php';
  this.landingUrl = '/';
  this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/45.0.2454.46 Safari/537.36';

  // base URLs for Image files like album artwork, artist prfiles, etc.
  // these values taken from "spotify.web.client.js"
  this.sourceUrl = 'https://d3rt1990lpmkn.cloudfront.net';
  this.sourceUrls = {
    tiny:   this.sourceUrl + '/60/',
    small:  this.sourceUrl + '/120/',
    normal: this.sourceUrl + '/300/',
    large:  this.sourceUrl + '/640/',
    avatar: this.sourceUrl + '/artist_image/'
  };

  // mappings for the protobuf `enum Size`
  this.sourceUrls.DEFAULT = this.sourceUrls.normal;
  this.sourceUrls.SMALL = this.sourceUrls.tiny;
  this.sourceUrls.LARGE = this.sourceUrls.large;
  this.sourceUrls.XLARGE = this.sourceUrls.avatar;
  
  this.sourceUrls[0] = this.sourceUrls.DEFAULT;
  this.sourceUrls[1] = this.sourceUrls.SMALL;
  this.sourceUrls[2] = this.sourceUrls.LARGE;
  this.sourceUrls[3] = this.sourceUrls.XLARGE;

  // WebSocket agent
  this.wsAgent = new https.Agent();
  this.wsAgent.createConnection = createHttpsConnection;

  // WebSocket callbacks
  this._onopen = this._onopen.bind(this);
  this._onclose = this._onclose.bind(this);
  this._onmessage = this._onmessage.bind(this);

  // start the "heartbeat" once the WebSocket connection is established
  this.once('connect', this._startHeartbeat);

  // handle "message" commands...
  this.on('message', this._onmessagecommand);
  
  this._trackkeyCallbacks = [];

  // binded callback for when user doesn't pass a callback function
  this._defaultCallback = this._defaultCallback.bind(this);
}
inherits(Spotify, EventEmitter);

/**
  * Emulating Spotify's "CodeValidator" object
  *
  * @param {String} vmScript The javascript code to execute
  * @api public
  */

Spotify.prototype.runInModifiedContext = function(vmScript) {
  try {
    var _context = vm.createContext();
    _context.reply = this._reply.bind(this);
    // required for "sp/track_uri2"
    _context.Spotify = function(fn) {
      return {
        Utils: {
          Base62: {
            fromHex: function(data, length) { fn(data); }
          },
          base62hex: function() {}
        }
      };
    }(this._trackkey.bind(this));
    vmScript.runInContext(_context);
  }
  catch (error) {
    return error;
  }
};

/**
 * Creates the connection to the Spotify Web websocket server and logs in using
 * the given Spotify `username` and `password` credentials.
 *
 * @param {String} un username
 * @param {String} pw password
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.login = function (un, pw, fn) {
  debug('Spotify#login(%j, %j)', un, pw.replace(/./g, '*'));

  // save credentials for later...
  this.creds = { username: un, password: pw, type: 'sp' };

  this._setLoginCallbacks(fn);
  this._makeLandingPageRequest();
};

/**
 * Creates the connection to the Spotify Web websocket server and logs in using
 * an anonymous identity.
 *
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.anonymousLogin = function (fn) {
  debug('Spotify#anonymousLogin()');

  // save credentials for later...
  this.creds = { type: 'anonymous' };

  this._setLoginCallbacks(fn);
  this._makeLandingPageRequest();
};

/**
 * Creates the connection to the Spotify Web websocket server and logs in using
 * the given Facebook App OAuth token and corresponding user ID.
 *
 * @param {String} fbuid facebook user Id
 * @param {String} token oauth token
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.facebookLogin = function (fbuid, token, fn) {
  debug('Spotify#facebookLogin(%j, %j)', fbuid, token);

  // save credentials for later...
  this.creds = { fbuid: fbuid, token: token, type: 'fb' };

  this._setLoginCallbacks(fn);
  this._makeLandingPageRequest();
};

/**
 * Sets the login and error callbacks to invoke the specified callback function
 *
 * @param {Function} fn callback function
 * @api private
 */

Spotify.prototype._setLoginCallbacks = function(fn) {
  var self = this;
  function onLogin () {
    cleanup();
    fn();
  }
  function onError (err) {
    cleanup();
    fn(err);
  }
  function cleanup () {
    self.removeListener('login', onLogin);
    self.removeListener('error', onError);
  }
  if ('function' == typeof fn) {
    this.on('login', onLogin);
    this.on('error', onError);
  }
};

/**
 * Makes a request for the landing page to get the CSRF token.
 *
 * @api private
 */

Spotify.prototype._makeLandingPageRequest = function() {
  var url = 'https://' + this.authServer + this.landingUrl;
  debug('GET %j', url);
  this.agent.get(url)
    .set({ 'User-Agent': this.userAgent })
    .end(this._onsecret.bind(this));
};

/**
 * Called when the Facebook redirect URL GET (and any necessary redirects) has
 * responded.
 *
 * @api private
 */

Spotify.prototype._onsecret = function (err, res) {
  if (err) return this.emit('error', err);
  if (res.error) return this.emit('error', "Error " + res.statusCode + ": Unable to connect to Spotify. Please try connecting to https://play.spotify.com.");
  debug('landing page: %d status code, %j content-type', res.statusCode, res.headers['content-type']);
  var $ = cheerio.load(res.text);

  // need to grab the CSRF token and trackingId from the page.
  // currently, it's inside an Object that gets passed to a
  // `new Spotify.Web.Login()` call as the second parameter.
  var args;
  var scripts = $('script');
  function login (doc, data) {
    debug('Spotify.Web.Login()');
    args = data;
    return { init: function () { /* noop */ } };
  }
  for (var i = 0; i < scripts.length; i++) {
    var code = scripts.eq(i).text();
    if (~code.indexOf('Spotify.Web.Login')) {
      vm.runInNewContext(code, { document: null, Spotify: { Web: { Login: login, App: { initialize: function() { } } } } });
    }
  }
  debug('login CSRF token: %j, tracking ID: %j', args.csrftoken, args.trackingId);

  // construct credentials object to send from stored credentials
  var creds = this.creds;
  delete this.creds;
  creds.secret = args.csrftoken;
  creds.trackingId = args.trackingId;
  creds.landingURL = args.landingURL;
  creds.referrer = args.referrer;
  creds.cf = null;

  // now we have to "auth" in order to get Spotify Web "credentials"
  var url = 'https://' + this.authServer + this.authUrl;
  debug('POST %j', url);
  this.agent.post(url)
    .set({ 'User-Agent': this.userAgent })
    .type('form')
    .send(creds)
    .end(this._onauth.bind(this));
};

/**
 * Called upon the "auth" endpoint's HTTP response.
 *
 * @api private
 */

Spotify.prototype._onauth = function (err, res) {
  if (err) return this.emit('error', err);

  debug('auth %d status code, %j content-type', res.statusCode, res.headers['content-type']);
  if ('ERROR' == res.body.status) {
    // got an error...
    var msg = res.body.error;
    if (res.body.message) msg += ': ' + res.body.message;
    this.emit('error', new Error(msg));
  } else {
    this.settings = res.body.config;
    this._resolveAP();
  }
};

/**
 * Resolves the WebSocket AP to connect to
 * Should be called after the _onauth() function
 *
 * @api private
 */

Spotify.prototype._resolveAP = function () {
  var query = { client: '24:0:0:' + this.settings.version };
  var resolver = this.settings.aps.resolver;
  debug('ap resolver %j', resolver);
  if (resolver.site) query.site = resolver.site;

  // connect to the AP resolver endpoint in order to determine
  // the WebSocket server URL to connect to next
  var url = 'http://' + resolver.hostname;
  debug('GET %j', url);
  this.agent.get(url)
    .set({ 'User-Agent': this.userAgent })
    .query(query)
    .end(this._openWebsocket.bind(this));
};

/**
 * Opens the WebSocket connection to the Spotify Web server.
 * Should be called upon AP resolver's response.
 *
 * @api private.
 */

Spotify.prototype._openWebsocket = function (err, res) {
  if (err) return this.emit('error', err);

  debug('ap resolver %d status code, %j content-type', res.statusCode, res.headers['content-type']);
  var ap_list = res.body.ap_list;
  var url = 'wss://' + ap_list[0] + '/';

  debug('WS %j', url);
  this.ws = new WebSocket(url, null, {
    "agent": this.wsAgent,
    "origin": "https://play.spotify.com",
    "headers":{"User-Agent": this.userAgent}
  });
  this.ws.on('open', this._onopen);
  this.ws.on('close', this._onclose);
  this.ws.on('message', this._onmessage);
};

/**
 * WebSocket "open" event.
 *
 * @api private
 */

Spotify.prototype._onopen = function () {
  debug('WebSocket "open" event');
  this.emit('open');
  if (!this.connected) {
    // need to send "connect" message
    this.connect();
  }
};

/**
 * WebSocket "close" event.
 *
 * @api private
 */

Spotify.prototype._onclose = function () {
  debug('WebSocket "close" event');
  this.emit('close');
  if (this.connected) {
    this.disconnect();
  }
};

/**
 * WebSocket "message" event.
 *
 * @param {String}
 * @api private
 */

Spotify.prototype._onmessage = function (data) {
  debug('WebSocket "message" event: %s', data);
  var msg;
  try {
    msg = JSON.parse(data);
  } catch (e) {
    return this.emit('error', e);
  }

  var self = this;
  var id = msg.id;
  var callbacks = this._callbacks;

  function fn (err, res) {
    var cb = callbacks[id];
    if (cb) {
      // got a callback function!
      delete callbacks[id];
      cb.call(self, err, res, msg);
    }
  }

  if ('error' in msg) {
    var err = new SpotifyError(msg.error);
    if (null == id) {
      this.emit('error', err);
    } else {
      fn(err);
    }
  } else if ('message' in msg) {
    var command = msg.message[0];
    var args = msg.message.slice(1);
    this.emit('message', command, args);
  } else if ('id' in msg) {
    fn(null, msg);
  } else {
    // unhandled command
    console.error(msg);
    throw new Error('TODO: implement!');
  }
};

/**
 * Handles a "message" command. Specifically, handles the "do_work" command and
 * executes the specified JavaScript in the VM.
 *
 * @api private
 */

Spotify.prototype._onmessagecommand = function (command, args) {
  if ('do_work' == command) {
    var js = args[0];
    debug('got "do_work" payload: %j', js);
    try {
      this.runInModifiedContext(new vm.Script(js));
    } catch (e) {
      this.emit('error', e);
    }
  } else if ('ping_flash2' == command) {
    this.sendPong(args[0]);
  } else if ('login_complete' == command) {
    this.sendCommand('sp/log', [41, 1, 0, 0, 0, 0]); // Spotify.Logging.Logger#logWindowSize
    this.sendCommand('sp/user_info', this._onuserinfo.bind(this));
  } else if ('album_art' == command) {
    var js = "window = {eval: eval}; " + args[0][1];
    try {
      this.runInModifiedContext(new vm.Script(js));
    } catch (e) {
      this.emit('error', e);
    }
  } else {
    // unhandled message
    console.error(command, args);
    throw new Error('TODO: implement!');
  }
};

/**
 * Called when the "sp/work_done" command is completed.
 *
 * @api private
 */

Spotify.prototype._onworkdone = function (err, res) {
  if (err) return this.emit('error', err);
  debug('"sp/work_done" ACK');
};

/**
 * Responds to a `sp/ping_flash2` request.
 *
 * @param {String} ping the argument sent from the request
 */

 Spotify.prototype.sendPong = function(ping) {
   function ping_pong(paddle) {
 	for(var ab=paddle.split(' '),a={},L=0;L<ab.length;L++){var wa=parseInt(ab[L]);a[4*L+1]=wa&255;a[4*L+2]=wa>>8&255;
 	a[4*L+3]=wa>>16&255;a[4*L+4]=wa>>24&255}var W,M,Ka,b,x,ia,N,bb,xa,O,X,La,q,ya,d,ja,C,l,g,D,Ma,ka,r,e,la,Y,za,
 	h,y,Aa,E,Na,t,Z,F,P,Oa,Q,R,Pa,Qa,ma,Ba,Ca,na,m,Ra,z,aa,oa,pa,ba,S,Da,ca,u,da,Sa,Ea,G,H,qa,v,I,Ta,J,Ua,ra,c,sa,
 	Fa,ta,f,ua,va,Va,Wa,Ga,Xa,Ha,ea,w,Ya,A,K,T,Za,n,$a,fa,p,ga,U,k,B,V,Ia,ha,Ja;n=a[0]=1;r=a[0];H=a[r+4];b=a[0];
 	C=a[b+24];A=b+24;H<C&&(b=a[0],c=a[b+28],a[A]=c,a[b+28]=C,C=c);ha=a[0];b=a[ha+64];G=b^42;a[ha+64]=G;l=a[0];
 	b=a[l+56];N=b^42;a[l+56]=N;b=a[0];h=b+20;Ba=a[b+20];b=Ba^23;c=a[0];x=c+68;q=a[c+68];c=q^201;
 	b>=c?(b=a[0],va=a[b+8]):(b=a[0],c=a[b+72],c^=65,a[b+72]=c,b=a[0],c=a[b+8],va=c^65,a[b+8]=va);B=a[0];b=a[B+48];
 	da=b^136;a[B+48]=da;v=a[0];b=a[v+52];Y=b^136;a[v+52]=Y;Ja=a[0];J=a[Ja+36];za=a[n];a[Ja+36]=za;a[n]=J;c=C^127;
 	b=va^39;bb=a[0];b<c&&(J^=186,a[n]=J,b=a[0],c=a[b+44],c^=186,a[b+44]=c);Za=a[0];z=a[Za+16];Oa=C;z<Ba&&(a[A]=Y,
 	a[v+52]=C,Oa=Y,Y=C);k=Za+16;u=a[0];b=a[u+76];a[u+76]=H;D=Y^4;a[v+52]=D;K=a[0];Ca=a[K+40];c=Ca^4;a[K+40]=c;
 	Aa=a[0];ya=a[Aa+72];a[Aa+72]=z;a[k]=ya;Da=Oa^188;a[A]=Da;Ua=b^188;a[r+4]=Ua;w=a[0];U=a[w+12];a[w+12]=N;a[l+56]=U;
 	Na=a[0];ra=a[Na+28];ia=da;ra<da&&(a[B+48]=G,a[ha+64]=da,ia=G,G=da);O=N;q<N&&(a[w+12]=H,a[u+76]=N,O=H,H=N);b=U^41;
 	c=H^253;c<b&&(c=a[0],b=a[c+32],a[c+32]=D,D=a[v+52]=b);ma=J;z<Da&&(a[x]=J,ma=a[n]=q,q=J);Ya=a[0];b=G^193;na=a[Ya+44];
 	c=na^54;c<b&&(U^=51,a[l+56]=U,O^=51,a[w+12]=O);e=Ja+36;V=Aa+72;ba=Na+28;a[x]=D;a[e]=q;a[v+52]=za;b=O^15;a[w+12]=b;
 	b=ra^15;a[ba]=b;a[V]=ya;a[k]=z;c=G^89;qa=a[0];ua=a[qa+60];b=ua^204;$a=D;b<c&&(a[x]=q,a[e]=D,$a=q,q=D);ea=bb+8;
 	ga=Ya+44;b=ma^9;a[n]=b;b=59*Ua;b+=8555;Ha=b%255;a[r+4]=Ha;b=220*va;b+=53020;ja=b%255;a[ea]=ja;b=O^184;b*=141;
 	P=b%255;a[w+12]=P;Ra=z^25;a[k]=Ra;b=153*Ba;b%=255;ca=b^37;a[h]=ca;b=214*Da;b+=15622;Ma=b%255;a[A]=Ma;b=ra^162;
 	a[ba]=b;Qa=a[0];a[Qa+32]=0;b=149*q;b%=255;ka=b^138;a[e]=ka;b=Ca^114;a[K+40]=b;b=U^223;W=b%255;a[ga]=W;Xa=ia^191;
 	a[B+48]=Xa;S=na^166;a[v+52]=S;b=za^84;b*=25;sa=b%255;a[l+56]=sa;b=ua^216;a[qa+60]=b;b=65*G;b+=12675;Q=b%255;
 	a[ha+64]=Q;b=151*$a;b+=20234;m=b%255;a[x]=m;b=49*ya;xa=b%255;g=xa^103;a[V]=g;b=198*H;Ta=b%255;Sa=Ta^84;a[u+76]=Sa;
 	c=P^208;b=sa^192;Ga=ka;b<c&&(a[h]=ka,Ga=a[e]=ca,ca=ka);R=Ga^74;a[e]=R;a[u+76]=Xa;a[B+48]=Sa;d=ca^38;a[h]=d;b=ma^101;
 	a[n]=b;a[x]=Ra;a[k]=m;b=P^199;c=xa^206;c<b&&(m^=89,a[k]=m,R=Ga^19,a[e]=R);Ia=ra^128;a[ba]=Ia;La=ma^71;a[n]=La;T=P;
 	ja<g&&(a[e]=P,T=a[w+12]=R,R=P);F=ia^26;a[u+76]=F;f=Ha^165;a[r+4]=f;F<m&&(f=Ha^98,a[r+4]=f,d=ca^225,a[h]=d);b=W^230;
 	a[ga]=b;oa=Ca^148;a[K+40]=oa;b=ja^52;c=W^215;E=oa;c<b&&(a[K+40]=f,a[r+4]=oa,E=f,f=oa);pa=Qa+32;a[pa]=130;fa=ua^90;
 	a[qa+60]=fa;p=sa^92;a[l+56]=p;Wa=z^69;a[x]=Wa;c=d^247;b=d^79;b<c&&(g=xa^114,a[V]=g,m^=21,a[k]=m);la=R^227;a[e]=la;
 	Ka=ja^227;a[ea]=Ka;c=g^104;b=T^107;t=la;b<c&&(a[e]=d,a[h]=la,t=d,d=la);b=115*La;Fa=b%255;b=Fa^11;a[n]=b;b=Q^35;
 	c=na^6;c<b&&(b=35*f,b%=255,f=b^219,a[r+4]=f);b=74*Ka;Ea=b%255;aa=Ea^234;a[ea]=aa;E<Ia&&(b=150*T,b+=4650,T=b%255,
 	a[w+12]=T);b=m<<4;Va=b%255;I=Va^201;a[k]=I;F<aa&&(b=d^39,b*=91,d=b%255,a[h]=d);b=247*Ma;Pa=b%255;M=Pa^211;a[A]=M;
 	b=147*Ia;b+=6468;c=b%255;a[ba]=c;a[pa]=201;b=na^43;c^=248;c<b&&(b=30*t,b+=6180,t=b%255,a[e]=t);c=z^161;b=Ea^121;
 	b<c&&(b=E^73,b*=14,E=b%255,a[K+40]=E);b=W^128;a[ga]=b;b=Ta^160;b*=155;y=b%255;a[B+48]=y;b=g^172;c=y^230;
 	c<b&&(b=59*S,b%=255,S=b^150,a[v+52]=S);Wa<g&&(p=sa^185,a[l+56]=p);F<S&&(fa=ua^130,a[qa+60]=fa);b=f^93;c=Ea^28;
 	c<b&&(b=Q^158,b*=98,Q=b%255,a[ha+64]=Q);y<aa&&(t^=157,a[e]=t,g^=157,a[V]=g);t<y&&(I=Va^103,a[k]=I,p^=174,a[l+56]=p);
 	F<f&&(I^=17,a[k]=I,p^=17,a[l+56]=p);ta=f^221;a[r+4]=ta;X=Fa^104;a[n]=X;Z=d^190;a[h]=Z;a[A]=F;a[u+76]=M;a[l+56]=E;
 	a[K+40]=p;aa<E&&(Z=d^149,a[h]=Z,ta=f^246,a[r+4]=ta);b=fa^21;c=fa^164;c<b&&(y^=168,a[B+48]=y,a[pa]=97);a[n]=t;a[e]=Z;
 	a[h]=X;b=ia^131;b<Z&&(X=Fa^147,a[h]=X,M=Pa^40,a[u+76]=M);a[k]=M;a[u+76]=I;b=M^118;c=Q^207;c<b&&(a[V]=aa,a[ea]=g);
 	a[A]=y;a[B+48]=F;b=z^37;a[x]=b;b=T^96;a[w+12]=b;c=ta^103;b=X^10;b<c&&(b=S^80,a[v+52]=b,b=W^208,a[ga]=b);
 	return [a[ga],a[k],a[ea],a[ba],a[A],a[x],a[V],a[h],a[pa],a[e]].join(' ');
   }

   var pong = ping_pong(ping);
   this.sendCommand('sp/pong_flash2', [pong]);
 };

/**
 * Sends a "message" across the WebSocket connection with the given "name" and
 * optional Array of arguments.
 *
 * @param {String} name command name
 * @param {Array} args optional Array or arguments to send
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.sendCommand = function (name, args, fn) {
  if ('function' == typeof args) {
    fn = args;
    args = [];
  }
  debug('sendCommand(%j, %j)', name, args);
  var msg = {
    name: name,
    id: String(this.seq++),
    args: args || []
  };
  if ('function' == typeof fn) {
    // store callback function for later
    debug('storing callback function for message id %s', msg.id);
    this._callbacks[msg.id] = fn;
  }
  var data = JSON.stringify(msg);
  debug('sending command: %s', data);
  try {
    this.ws.send(data);
  } catch (e) {
    this.emit('error', e);
  }
};

/**
 * Makes a Protobuf request over the WebSocket connection.
 * Also known as a MercuryRequest or Hermes Call.
 *
 * @param {Object} req protobuf request object
 * @param {Function} fn (optional) callback function
 * @api public
 */

Spotify.prototype.sendProtobufRequest = function(req, fn) {
  debug('sendProtobufRequest(%j)', req);

  // extract request object
  var isMultiGet = req.isMultiGet || false;
  var payload = req.payload || [];
  var header = {
      uri: '',
      method: '',
      source: '',
      contentType: isMultiGet ? 'vnd.spotify/mercury-mget-request' : ''
  };
  if (req.header) {
    header.uri = req.header.uri || '';
    header.method = req.header.method || '';
    header.source = req.header.source || '';
  }

  // load payload and response schemas
  var loadSchema = function(schema, dontRecurse) {
    if ('string' === typeof schema) {
      var schemaName = schema.split("#");
      schema = schemas.build(schemaName[0], schemaName[1]);
      if (!schema)
        throw new Error('Could not load schema: ' + schemaName.join('#'));
    } else if (schema && !dontRecurse && (!schema.hasOwnProperty('parse') && !schema.hasOwnProperty('serialize'))) {
      var keys = Object.keys(schema);
      keys.forEach(function(key) {
        schema[key] = loadSchema(schema[key], true);
      });
    }
    return schema;
  };

  var payloadSchema = isMultiGet ? MercuryMultiGetRequest : loadSchema(req.payloadSchema);
  var responseSchema = loadSchema(req.responseSchema);
  var isMultiResponseSchema = (!responseSchema.hasOwnProperty('parse'));

  var parseData = function(type, data, dontRecurse) {
    var parser = responseSchema;
    var ret;
    if (!dontRecurse && 'vnd.spotify/mercury-mget-reply' == type) {
      ret = [];
      var response = self._parse(MercuryMultiGetReply, data);
      response.reply.forEach(function(reply) {
        var data = parseData(reply.contentType, new Buffer(reply.body, 'base64'), true);
        ret.push(data);
      });
      debug('parsed multi-get response - %d items', ret.length);
    } else {
      if (isMultiResponseSchema) {
        if (responseSchema.hasOwnProperty(type)) {
          parser = responseSchema[type];
        } else {
          throw new Error('Unrecognised metadata type: ' + type);
        }
      }
      ret = self._parse(parser, data);
      debug('parsed response: [ %j ] %j', type, ret);
    }
    return ret;
  };

  function getNumber (method) {
    switch(method) {
    case "SUB":
      return 1;
    case "UNSUB":
      return 2;
    default:
      return 0;
    }
  }

  // construct request
  var args = [ getNumber(header.method) ];
  var data = MercuryRequest.serialize(header).toString('base64');
  args.push(data);

  if (isMultiGet) {
    if (Array.isArray(req.payload)) {
      req.payload = {request: req.payload};
    } else if (!req.payload.request) {
      throw new Error('Invalid payload for Multi-Get Request.');
    }
  }

  if (payload && payloadSchema) {
    data = payloadSchema.serialize(req.payload).toString('base64');
    args.push(data);
  }

  // send request and parse response, pass data back to callback
  var self = this;
  this.sendCommand('sp/hm_b64', args, function (err, res) {
    if ('function' !== typeof fn) return; // give up if no callback
    if (err) return fn(err);

    var header = self._parse(MercuryRequest, new Buffer(res.result[0], 'base64'));
    debug('response header: %j', header);

    // TODO: proper error handling, handle 300 errors

    var message;
    if (header.statusCode >= 400 && header.statusCode < 500) {
      message = header.statusMessage || http.STATUS_CODES[header.statusCode] || 'Unknown Error';
      return fn(new Error('Client Error: ' + message + ' (' + header.statusCode + ')'));
    }

    if (header.statusCode >= 500 && header.statusCode < 600) {
      message = header.statusMessage || http.STATUS_CODES[header.statusCode] || 'Unknown Error';
      return fn(new Error('Server Error: ' + message + ' (' + header.statusCode + ')'));
    }

    if (isMultiGet && 'vnd.spotify/mercury-mget-reply' !== header.contentType)
      return fn(new Error('Server Error: Server didn\'t send a multi-GET reply for a multi-GET request!'));

    var data = parseData(header.contentType, new Buffer(res.result[1], 'base64'));
    fn(null, data);
  });
};

/**
 * Sends the "connect" command. Should be called once the WebSocket connection is
 * established.
 *
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.connect = function (fn) {
  debug('connect()');
  var creds = this.settings.credentials[0].split(':');
  var args = [ creds[0], creds[1], creds.slice(2).join(':') ];
  this.sendCommand('connect', args, this._onconnect.bind(this));
};

/**
 * Closes the WebSocket connection of present. This effectively ends your Spotify
 * Web "session" (and derefs from the event-loop, so your program can exit).
 *
 * @api public
 */

Spotify.prototype.disconnect = function () {
  debug('disconnect()');
  this.connected = false;
  clearInterval(this._heartbeatId);
  this._heartbeatId = null;
  if (this.ws) {
    this.ws.close();
    this.ws = null;
  }
};

/**
 * Gets the "metadata" object for one or more URIs.
 *
 * @param {Array|String} uris A single URI, or an Array of URIs to get "metadata" for
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.get =
Spotify.prototype.metadata = function (uris, fn) {
  debug('metadata(%j)', uris);
  if (!Array.isArray(uris)) {
    uris = [ uris ];
  }
  // array of "request" Objects that will be protobuf'd
  var requests = [];
  var mtype = '';
  uris.forEach(function (uri) {
    var type = util.uriType(uri);
    if ('local' == type) {
      debug('ignoring "local" track URI: %j', uri);
      return;
    }
    var id = util.uri2id(uri);
    mtype = type;
    requests.push({
      method: 'GET',
      uri: 'hm://metadata/3/' + type + '/' + id
    });
  });


  var header = {
    method: 'GET',
    uri: 'hm://metadata/3/' + mtype + 's'
  };
  var multiGet = true;
  if (requests.length == 1) {
    header = requests[0];
    requests = null;
    multiGet = false;
  }

  this.sendProtobufRequest({
    header: header,
    payload: requests,
    isMultiGet: multiGet,
    responseSchema: {
      'vnd.spotify/metadata-artist': Artist,
      'vnd.spotify/metadata-album': Album,
      'vnd.spotify/metadata-track': Track
    }
  }, function(err, item) {
    if (err) return fn(err);
    item._loaded = true;
    fn(null, item);
  });
};

/**
 * Gets the metadata from a Spotify "playlist" URI.
 *
 * @param {String} uri playlist uri
 * @param {Number} from (optional) the start index. defaults to 0.
 * @param {Number} length (optional) number of tracks to get. defaults to 100.
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.playlist = function (uri, from, length, fn) {
  // argument surgery
  if ('function' == typeof from) {
    fn = from;
    from = length = null;
  } else if ('function' == typeof length) {
    fn = length;
    length = null;
  }
  if (null == from) from = 0;
  if (null == length) length = 100;

  debug('playlist(%j, %j, %j)', uri, from, length);
  var self = this;
  var parts = uri.split(':');
  var user = parts[2];
  var id = parts[4];
  var hm = 'hm://playlist/user/' + user + '/playlist/' + id +
    '?from=' + from + '&length=' + length;

  this.sendProtobufRequest({
    header: {
      method: 'GET',
      uri: hm
    },
    responseSchema: SelectedListContent
  }, fn);
};

/**
 * Gets a user's starred playlist
 *
 * @param {Number} from (optional) the start index. defaults to 0.
 * @param {Number} length (optional) number of tracks to get. defaults to 100.
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.starred = function (user, from, length, fn) {
  // argument surgery
  if ('function' == typeof from) {
    fn = from;
    from = length = null;
  } else if ('function' == typeof length) {
    fn = length;
    length = null;
  }
  if (null == from) from = 0;
  if (null == length) length = 100;

  debug('starred(%j, %j, %j)', user, from, length);

  var self = this;
  var hm = 'hm://playlist/user/' + user + '/starred?from=' + from + '&length=' + length;

  this.sendProtobufRequest({
    header: {
      method: 'GET',
      uri: hm
    },
    responseSchema: SelectedListContent
  }, fn);
};

/**
 * Gets a user's music library
 *
 * @param {Number} from (optional) the start index. defaults to 0.
 * @param {Number} length (optional) number of tracks to get. defaults to 100.
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.library = function (user, from, length, fn) {
  // argument surgery
  if ('function' == typeof from) {
    fn = from;
    from = length = null;
  } else if ('function' == typeof length) {
    fn = length;
    length = null;
  }
  if (null == from) from = 0;
  if (null == length) length = 100;

  debug('starred(%j, %j, %j)', user, from, length);

  var self = this;
  var hm = 'hm://collection-web/v1/' + user.toLowerCase() + '/songslist?start=' + from + '&length=' + length;
  var header = {
      method: "GET",
      uri: hm
  };
  this.sendCommand("sp/hm_b64", [0, MercuryRequest.serialize(header).toString("base64")], function(err, data) {
    var data = JSON.parse(new Buffer(data.result[1], "base64").toString());
    fn(err, {
        attributes: {
          name: "Library"
        },
        contents: {
          pos: from,
          truncated: data.length == length,
          items: data
        }
    });
  });
};

/**
 * Gets the user's stored playlists
 *
 * @param {String} user (optional) the username for the rootlist you want to retrieve. defaults to current user.
 * @param {Number} from (optional) the start index. defaults to 0.
 * @param {Number} length (optional) number of tracks to get. defaults to 100.
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.rootlist = function (user, from, length, fn) {
  // argument surgery
  if ('function' == typeof user) {
    fn = user;
    from = length = user = null;
  } else if ('function' == typeof from) {
    fn = from;
    from = length = null;
  } else if ('function' == typeof length) {
    fn = length;
    length = null;
  }
  if (null == user) user = this.username;
  if (null == from) from = 0;
  if (null == length) length = 100;

  debug('rootlist(%j, %j, %j)', user, from, length);

  var self = this;
  var hm = 'hm://playlist/user/' + user + '/rootlist?from=' + from + '&length=' + length;

  this.sendProtobufRequest({
    header: {
      method: 'GET',
      uri: hm
    },
    responseSchema: SelectedListContent
  }, fn);
};

/**
 * Retrieve suggested similar tracks to the given track URI
 *
 * @param {String} uri track uri
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.similar = function(uri, fn) {
  debug('similar(%j)', uri);

  var parts = uri.split(':');
  var type = parts[1];
  var id = parts[2];

  if (!type || !id || 'track' != type)
    throw new Error('uri must be a track uri');

  this.sendProtobufRequest({
    header: {
      method: 'GET',
      uri: 'hm://similarity/suggest/' + id
    },
    payload: {
      country: this.country || 'US',
      language: this.settings.locale.current || 'en',
      device: 'web'
    },
    payloadSchema: StoryRequest,
    responseSchema: StoryList
  }, fn);
};

/**
 * Gets the MP3 160k audio URL for the given "track" metadata object.
 *
 * @param {Object} track Track "metadata" instance
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.trackUri = function (track, fn) {
  debug('trackUri()');
  // TODO: make "format" configurable here
  this.recurseAlternatives(track, this.country, function (err, track) {
    if (err) return fn(err);
    
    var mp3160_file = track.file.filter(function(file) { return file.format == 7; })[0];
    if (mp3160_file == undefined) {
        fn(new Error('Can\'t find mp3160 format for song'));
    }
    
    var args = [ util.gid2id(track.gid), util.gid2id(mp3160_file.fileId) ];
    debug('sp/track_uri args: %j', args);
    this.sendCommand('sp/track_uri2', args, function (err, res) {
      if (err) return fn(err);
      this._trackkeyCallbacks.push(function(key) {
        fn(null, res.result, new crypto.EncryptedStream(key));
      });
    });
  }.bind(this));
};

/**
 * Checks if the given track "metadata" object is "available" for playback, taking
 * account for the allowed/forbidden countries, the user's current country, the
 * user's account type (free/paid), etc.
 *
 * @param {Object} track Track "metadata" instance
 * @param {String} country 2 letter country code to check if the track is playable for
 * @return {Boolean} true if track is playable, false otherwise
 * @api public
 */

Spotify.prototype.isTrackAvailable = function (track, country) {
  if (!country) country = this.country;
  debug('isTrackAvailable()');

  var account = {
    catalogue: this.accountType,
    country: country
  };

  return this.isPlayable(
      this.parseRestrictions(track.restriction, account),
      account
  );
};

/**
 * @param {String} availability Track availability
 * @param {Object} account Account details {catalogue, country}
 * @api public
 */

Spotify.prototype.isPlayable = function(availability, account) {
  if(availability === "premium" && account.catalogue === "premium") {
    return true;
  }

  return availability === "available";
};

/**
 * @param {Array} restrictions Track restrictions
 * @param {Object} account Account details {catalogue, country}
 * @api public
 */

Spotify.prototype.parseRestrictions = function(restrictions, account) {
  debug('parseRestrictions() account: %j', account);

  var catalogues = {},
      available = false;

  if ("undefined" === typeof restrictions || 0 === restrictions.length) {
    // Track has no restrictions
    return "available";
  }

  for (var ri = 0; ri < restrictions.length; ++ri) {
    var restriction = restrictions[ri],
        valid = true,
        allowed;

    if(restriction.countriesAllowed != void 0) {
      // Check if account region is allowed
      valid = restriction.countriesAllowed.length !== 0;
      allowed = has(restriction.allowed, account.country);
    } else {
      // Check if account region is forbidden
      if(restriction.countriesForbidden != void 0) {
        allowed = !has(restriction.forbidden, account.country);
      } else {
        allowed = true;
      }
    }

    if (allowed && restriction.catalogueStr != void 0) {
      // Update track catalogues
      for (var ci = 0; ci < restriction.catalogueStr.length; ++ci) {
        var key = restriction.catalogueStr[ci];

        catalogues[key] = true;
      }
    }

    if (restriction.type == void 0 || "streaming" == restriction.type.toLowerCase()) {
      available |= valid;
    }
  }

  debug('parseRestrictions() catalogues: %j', catalogues);

  if(available && account.catalogue === "all") {
    // Account can stream anything
    return "available";
  }

  if(catalogues[account.catalogue]) {
    // Track can be streamed by this account
    if(account.catalogue === "premium") {
      return "premium";
    } else {
      return "available";
    }
  }

  if(catalogues.premium) {
    // Premium account required
    return "premium";
  }

  if(available) {
    // Track not available in the account region
    return "regional";
  }

  return "unavailable";
};

/**
 * Checks if the given "track" is "available". If yes, returns the "track"
 * untouched. If no, then the "alternative" tracks array on the "track" instance
 * is searched until one of them is "available", and then returns that "track".
 * If none of the alternative tracks are "available", returns `null`.
 *
 * @param {Object} track Track "metadata" instance
 * @param {String} country 2 letter country code to attempt to find a playable "track" for
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.recurseAlternatives = function (track, country, fn) {
  debug('recurseAlternatives()');
  function done () {
    process.nextTick(function () {
      fn(null, track);
    });
  }
  if (this.isTrackAvailable(track, country)) {
    return done();
  } else if (Array.isArray(track.alternative)) {
    var tracks = track.alternative;
    for (var i = 0; i < tracks.length; i++) {
      debug('checking alternative track %j', track.uri);
      track = tracks[i];
      if (this.isTrackAvailable(track, country)) {
        return done();
      }
    }
  }
  // not playable
  process.nextTick(function () {
    fn(new Error('Track is not playable in country "' + country + '"'));
  });
};

/**
 * Executes a "search" against the Spotify music library. Note that the response
 * is an XML data String, so you must parse it yourself.
 *
 * @param {String|Object} opts string search term, or options object with search
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.search = function (opts, fn) {
  if ('string' == typeof opts) {
    opts = { query: opts };
  }
  if (null == opts.maxResults || opts.maxResults > 50) {
    opts.maxResults = 50;
  }
  if (null == opts.type) {
    opts.type = 'all';
  }
  if (null == opts.offset) {
    opts.offset = 0;
  }
  if (null == opts.query) {
    throw new Error('must pass a "query" option!');
  }

  var types = {
    tracks: 1,
    albums: 2,
    artists: 4,
    playlists: 8
  };
  var type;
  if ('all' == opts.type) {
    type = types.tracks | types.albums | types.artists | types.playlists;
  } else if (Array.isArray(opts.type)) {
    type = 0;
    opts.type.forEach(function (t) {
      if (!types.hasOwnProperty(t)) {
        throw new Error('unknown search "type": ' + opts.type);
      }
      type |= types[t];
    });
  } else if (opts.type in types) {
    type = types[opts.type];
  } else {
    throw new Error('unknown search "type": ' + opts.type);
  }

  var args = [ opts.query, type, opts.maxResults, opts.offset ];
  this.sendCommand('sp/search', args, function (err, res) {
    if (err) return fn(err);
    // XML-parsing is left up to the user, since they may want to use libxmljs,
    // or node-sax, or node-xml2js, or whatever. So leave it up to them...
    fn(null, res.result);
  });
};

/**
 * Sends the "sp/track_end" event. This is required after each track is played,
 * otherwise Spotify limits you to 3 track URL fetches per session.
 *
 * @param {String} lid the track "lid"
 * @param {String} uri track spotify uri (not playback uri)
 * @param {Number} ms number of milliseconds played
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.sendTrackEnd = function (lid, uri, ms, fn) {
  debug('sendTrackEnd(%j, %j, %j)', lid, uri, ms);
  if (!fn) fn = this._defaultCallback;

  var ms_played = Number(ms);
  var ms_played_union = ms_played;
  var n_seeks_forward = 0;
  var n_seeks_backward = 0;
  var ms_seeks_forward = 0;
  var ms_seeks_backward = 0;
  var ms_latency = 100;
  var display_track = null;
  var play_context = 'unknown';
  var source_start = 'unknown';
  var source_end = 'unknown';
  var reason_start = 'unknown';
  var reason_end = 'unknown';
  var referrer = 'unknown';
  var referrer_version = '0.1.0';
  var referrer_vendor = 'com.spotify';
  var max_continuous = ms_played;
  var args = [
    lid,
    ms_played,
    ms_played_union,
    n_seeks_forward,
    n_seeks_backward,
    ms_seeks_forward,
    ms_seeks_backward,
    ms_latency,
    display_track,
    play_context,
    source_start,
    source_end,
    reason_start,
    reason_end,
    referrer,
    referrer_version,
    referrer_vendor,
    max_continuous
  ];
  this.sendCommand('sp/track_end', args, function (err, res) {
    if (err) return fn(err);
    if (null == res.result) {
      // apparently no result means "ok"
      fn();
    } else {
      // TODO: handle error case
    }
  });
};

/**
 * Sends the "sp/track_event" event. These are pause and play events (possibly
 * others).
 *
 * @param {String} lid the track "lid"
 * @param {String} event
 * @param {Number} ms number of milliseconds played so far
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.sendTrackEvent = function (lid, event, ms, fn) {
  debug('sendTrackEvent(%j, %j, %j)', lid, event, ms);
  var num = event;
  var args = [ lid, num, ms ];
  this.sendCommand('sp/track_event', args, function (err, res) {
    if (err) return fn(err);
    console.log(res);
  });
};

/**
 * Sends the "sp/track_progress" event. Should be called periodically while
 * playing a Track.
 *
 * @param {String} lid the track "lid"
 * @param {Number} ms number of milliseconds played so far
 * @param {Function} fn callback function
 * @api public
 */

Spotify.prototype.sendTrackProgress = function (lid, ms, fn) {
  debug('sendTrackProgress(%j, %j)', lid, ms);
  var ms_played = Number(ms);
  var source_start = 'unknown';
  var reason_start = 'unknown';
  var ms_latency = 100;
  var play_context = 'unknown';
  var display_track = '';
  var referrer = 'unknown';
  var referrer_version = '0.1.0';
  var referrer_vendor = 'com.spotify';
  var args = [
    lid,
    source_start,
    reason_start,
    ms_played,
    ms_latency,
    play_context,
    display_track,
    referrer,
    referrer_version,
    referrer_vendor
  ];
  this.sendCommand('sp/track_progress', args, function (err, res) {
    if (err) return fn(err);
    console.log(res);
  });
};

/**
 * "connect" command callback function. If the result was "ok", then get the
 * logged in user's info.
 *
 * @param {Object} res response Object
 * @api private
 */

Spotify.prototype._onconnect = function (err, res) {
  if (err) return this.emit('error', err);
  if ('ok' == res.result) {
    this.connected = true;
    this.emit('connect');
  } else {
    // TODO: handle possible error case
  }
};

/**
 * "sp/user_info" command callback function. Once this is complete, the "login"
 * event is emitted and control is passed back to the user for the first time.
 *
 * @param {Object} res response Object
 * @api private
 */

Spotify.prototype._onuserinfo = function (err, res) {
  if (err) return this.emit('error', err);
  this.username = res.result.user;
  this.country = res.result.country;
  this.accountType = res.result.catalogue;
  this.emit('login');
};

/**
 * Starts the interval that sends and "sp/echo" command to the Spotify server
 * every 18 seconds.
 *
 * @api private
 */

Spotify.prototype._startHeartbeat = function () {
  debug('starting heartbeat every %s seconds', this.heartbeatInterval / 1000);
  var fn = this._onheartbeat.bind(this);
  this._heartbeatId = setInterval(fn, this.heartbeatInterval);
};

/**
 * Sends an "sp/echo" command.
 *
 * @api private
 */

Spotify.prototype._onheartbeat = function () {
  this.sendCommand('sp/echo', 'h');
};

/**
 * Called when `this.reply()` is called in the "do_work" payload.
 *
 * @api private
 */

Spotify.prototype._reply = function () {
  var args = Array.prototype.slice.call(arguments);
  debug('reply(%j)', args);
  this.sendCommand('sp/work_done', args, this._onworkdone);
};

/**
 * Called when `Spotify.Base64.fromHex` is called in the "album_art" payload.
 * Required for "sp/track_uri2"
 *
 * @api private
 */

Spotify.prototype._trackkey = function (data) {
  debug('trackkey(%j)', data);
  var fn = this._trackkeyCallbacks.shift();
  if (fn != undefined) fn(data);
}

/**
 * Default callback function for when the user does not pass a
 * callback function of their own.
 *
 * @param {Error} err
 * @api private
 */

Spotify.prototype._defaultCallback = function (err) {
  if (err) this.emit('error', err);
};

/**
 * Wrapper around the Protobuf Schema's `parse()` function that also attaches this
 * Spotify instance as `_spotify` to each entry in the parsed object. This is
 * necessary so that instance methods (like `Track#play()`) have access to the
 * Spotify instance in order to interact with it.
 *
 * @api private
 */

Spotify.prototype._parse = function (parser, data) {
  var obj = parser.parse(data);
  tag(this, obj);
  return obj;
};

/**
 * XXX: move to `util`?
 * Attaches the `_spotify` property to each "object" in the passed in `obj`.
 *
 * @api private
 */

function tag(spotify, obj){
  if (obj === null || 'object' != typeof obj) return;
  Object.keys(obj).forEach(function(key){
    var val = obj[key];
    var type = typeof val;
    if ('object' == type) {
      if (Array.isArray(val)) {
        val.forEach(function (v) {
          tag(spotify, v);
        });
      } else {
        tag(spotify, val);
      }
    }
  });
  Object.defineProperty(obj, '_spotify', {
    value: spotify,
    enumerable: false,
    writable: true,
    configurable: true
  });
}

/**
 * XXX: move to `util`?
 * Returns `true` if `val` is present in the `array`. Returns `false` otherwise.
 *
 * @api private
 */

function has (array, val) {
  var rtn = false;
  if (Array.isArray(array)) {
    rtn = !!~array.indexOf(val);
  }
  return rtn;
}
