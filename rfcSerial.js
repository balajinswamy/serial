var path = require('path');
var express = require('express');

// Create a simple Express Based Server
var app = express();
app.use('/', express.static(path.join(__dirname, 'public')));

var server = app.listen(8081);
console.log('Server listening on port 8081');

// Socket.IO part
var io = require('socket.io')(server);
var commands = require('./commands');

io.on('connection', function (socket) {
	console.log('New client connected!');  	
	socket.on('disconnect', function() {
		console.log("user disconnected");
	});
	console.log('commands:', commands.listAllCommands());
	commands.listAllCommands().forEach(cmd => {
		// assign handlers for each known command
		socket.on(cmd, function(args) {
			// this is the actual handler for given command
			console.log('>>>', cmd, args);

			var callback = function(error, data) {
				console.log('... done');
				var payload;

				// even if error happened, we may still have some partial data
				// so handle them regardless
				if(data && typeof data === 'object') {
					payload = data;
				} else {
					payload = {result: data}; // probably undefined, if error happened
				}

				// if port was specified for the command,
				// include the same port path in the response
				// to help identify responses.
				if(args && args.port) {
					payload.port = args.port;
				}
				if(error) {
					payload.success = false;
					if(error.name && error.stack) {
						payload.error = error.toString();
						payload.stack = error.stack;
					} else {
						payload.error = error;
					}
					if(error.code) {
						payload.code = error.code;
						if(error.text) {
							// overwrite it here to have nicer values order
							payload.error = error.text;
						}
					}
				} else {
					payload.success = true;
				}

				if(payload.stack)
					console.log(payload.stack);
				console.log('<<<', payload);
				socket.emit(cmd, payload);
			};
			var callbacks = {
				progress:  data => {
					data.port = data.port || args.port;
					data.progress = data.progress || true;
					socket.emit(cmd, data);
				},
				broadcast: (cmd, args) => io.emit(cmd, args),
			};
			try {
				// find best implementation for this command with given args
				var cmd_fn = commands.dispatchCommand(cmd, args);
				// validate arguments
				// we will call validators based on which arguments are actually used;
				// NOTE this requires that we use decomposition
				// in command handler function signatures!
				var argnames = cmd_fn.toString().match(/\({([^}]+)}/);
				if(argnames) {
					argnames[1].replace(/\s*/, '').split(',').forEach(arg => {
						if(commands.ArgumentValidators[arg]) {
							// call validator, which will raise an error if desired
							commands.ArgumentValidators[arg](args[arg], cmd);
						}
					});
				} // else we don't validate anything

				cmd_fn(args, callbacks).then((result) => {
					callback(null, result);
				}).catch((err) => {
					if(typeof err === 'object' && err.error) {
						callback(err.error, err);
					} else {
						callback(err);
					}
				});
			} catch(err) {
				console.log('... ERROR', err);
				callback(err);
			}
		});
	});
});

////////
////////

// sendPortsList();
/* Console Output
Balajin-Mac:server balajin$ node rfcSerial.js 
Server listening on port 8081
port: { comName: '/dev/cu.Bluetooth-Incoming-Port',
  manufacturer: undefined,
  serialNumber: undefined,
  pnpId: undefined,
  locationId: undefined,
  vendorId: undefined,
  productId: undefined }
port: { comName: '/dev/cu.balajinsiPhone-Wireless',
  manufacturer: undefined,
  serialNumber: undefined,
  pnpId: undefined,
  locationId: undefined,
  vendorId: undefined,
  productId: undefined }
port: { comName: '/dev/cu.usbmodemFA131',
  manufacturer: 'RF Code, Inc.',
  serialNumber: undefined,
  pnpId: undefined,
  locationId: '0xfa130000',
  vendorId: '0x1c40',
  productId: '0x05f2' }
will be sending 3ports to ui
*/

//openPort('/dev/cu.usbmodemFA131');
/* Console Output (Note: with parser option set to "/n")
Balajin-Mac:server balajin$ node rfcSerial.js 
Server listening on port 8081
will try to open the path: /dev/cu.usbmodemFA131
drainCallback
data received: =VER,A740:V1.00:20100923_150338_P
data received: OK
data received: =VER,A740:V1.00:20100923_150338_P
data received: OK
data received: =SN,0131500NK00410
data received: OK
data received: =LOC,114
data received: OK
data received: =IRP,2
data received: OK
data received: =BRT,4
data received: OK
data received: =PAT,0003
data received: OK
data received: E,01
data received: E,01
data received: =DC,41
data received: OK
data received: =SEG,4,4,0,0,4,5
data received: OK

//////
!!Console Output (Note: with no parser option set)!!
Balajin-Mac:server balajin$ node rfcSerial.js 
Server listening on port 8081
will try to open the path: /dev/cu.usbmodemFA131
drainCallback
data received: =VER,A740:V1.00:20100923_150338_P
OK
=VER,A740:V1.00:20100923_150338_P
OK

data received: =SN,0131500NK00410
OK
=LOC,114
OK
=IRP,2
OK
=BRT,4
OK
=PAT,0003
OK
data received: 
E,01
E,01
=DC,41
OK
=SEG,4,4,0,0,4,5
OK

*/


