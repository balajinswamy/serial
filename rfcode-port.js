var SerialPort = require("serialport");
var Queue = require('promise-queue');
var devSpecific = require('./device-specific');

// Helper class which wraps Lightning protocol handling
var RFCodePort = function(port, options) {
	if(!(this instanceof RFCodePort)) {
		return new RFCodePort(port, callback);
	}
	this.port = port;
	this.options = options || {};
	this.options.timeout = this.options.timeout || 5000; // 5 seconds
	this.active = false;
	this.queue = new Queue(/*maxConcurrent=*/1);
	this.Constants = {
		// these are taken from original CSharp app
		flashStart: 0x1400,
		flashEnd: 0x3A00,
	};
	this.serial = new SerialPort(port, {
		baudrate: 19200, //Default is 9600, but setting it to 19200 can be adjusted based on the RFCode HW docs.
		parser: SerialPort.parsers.readline('\r\n'), //"readline" style parsing
		// \r\n is always used as a separator, according to docs
		autoOpen: false,
	});

	// now do open port
	['close', 'error', 'disconnect'].forEach(evt => {
		if(this.options['on'+evt]) {
			this.serial.on(evt, this.options['on'+evt]);
		}
	});
};
// instance methods
RFCodePort.prototype.open = function() {
	return new Promise((resolve, reject) => {
		this.serial.open(error => {
			if(error) return reject(error);
			resolve();
		});
	}).then(() => {
		console.log('Port opened, asking for version');
		// Special case: VER command might in theory fail;
		// so we want to have common error codes there already.
		// Later we will overwrite them with model-specific ones.
		this.Errors = devSpecific.errorsForModel('common');
		return this.sendCommand('VER');
	}).then(resp => {
		// now that we received version response,
		// we can be certain that there is an actual device
		// on the other side
		this.active = true;
		[this.version] = resp;
		console.log(`Device version ${this.version}`);
		[this.model] = this.version.split(':');
		this.Settings = devSpecific.settingsForModel(this.model);
		this.Errors = devSpecific.errorsForModel(this.model);

		return this.version;
	}).catch(err => {
		// on error always close port
		console.log('Opening port failed, closing port');
		this.close();
		// and re-throw error
		throw err;
	});
};
RFCodePort.prototype.sendCommand = function(cmd, args, mode) {
	// Put new command to queue, and return a promise for it.
	// Promise is then resolved with command's response - array of strings -
	// or with undefined value if there was no response.
	//
	// Optional 'mode' argument changes result parsing:
	//
	// if mode is 'multiple' then we will expect several responses
	// and return an array of arrays of strings (empty array if there was no response);
	//
	// if mode is 'raw' then we will return an array of all text lines
	// received until OK, without expecting command ident in the beginning
	// of each line.
	return this.queue.add(() => {
		return new Promise((resolve, reject) => {
			if(typeof args == 'string') {
				[args, mode] = [null, args];
			}
			args = args || [];
			var removeListeners = () => {
				// clear it just to avoid "Timeout" message in logs.
				// not required for logic (as promise will be already resolved),
				// but nicer.
				clearTimeout(timeout);
				this.serial.removeListener('data', onData);
			};
			var rejectIfError = error => {
				if(!error) {
					return;
				}
				// sending failed, so reject this promise
				// which will allow moving to next command.
				// TODO: do we want retries? most likely no,
				// especially for destructive commands?..
				removeListeners();
				reject(error);
			};

			var result;
			var timeout;
			var responseRegexp = new RegExp(`^=${cmd}(,(.*))?$`, 'i');

			if(mode == 'multiple' || mode == 'raw') {
				result = [];
			}

			// assign event handlers
			var onData = data => {
				// what did we receive?
				data = data.toString();
				console.log('--< ' + data);

				var err = data.match(/^E,(.*)$/);
				if(data == 'OK') {
					// successfully finished
					removeListeners();
					return resolve(result);
				} else if(err) {
					// command errored
					removeListeners();
					// notify our caller
					var code = parseInt(err[1]);
					var message = this.Errors.getMessage(code);
					var errObj = new Error(this.Errors.format(code));
					errObj.code = code;
					errObj.text = message;
					errObj.result = result; // in case there was some result
					// message is already set
					return reject(errObj);
				}
				if(mode == 'raw') {
					result.push(data);
					return;
				} else {
					var response = data.match(responseRegexp);
					if(response) {
						// we got command result; store it but don't call the callback
						// until OK (or E,xx) is received
						var curResult = response[2].split(',') || [];
						// ^^ if we got response without values, e.g. "=CAL",
						// we want to return empty array
						if(mode == 'multiple') {
							result.push(curResult);
						} else {
							// default mode: if we get several responses,
							// only last one will be preserved
							if(result) {
								console.log('WARNING got more than one response in non-multi mode; overwriting');
							}
							result = curResult;
						}
						return;
					}
				}
				console.log('WARNING got unexpected value');
			};
			this.serial.on('data', onData);

			var fullcmd = cmd;
			if(args.length) {
				fullcmd += ',';
				fullcmd += args.join(',');
			}
			// first, we want to discard any leftovers which could remain from previous commands or whatever
			this.serial.flush((error) => {
				if(error) {
					return rejectIfError(error);
				}
				// now do send our command
				console.log('--> ' + fullcmd);
				this.serial.write(fullcmd + '\r', rejectIfError);
				// ^^^ no need to wait for it to drain?..
				timeout = setTimeout(() => {
					console.log('... Timeout');
					rejectIfError(new Error('Command timed out'));
				}, this.options.timeout);
			});
		});
	});
};
RFCodePort.prototype.close = function(callback) {
	return new Promise((resolve, reject) => {
		console.log('Closing port '+this.port);
		this.serial.close(err => {
			this.active = false;
			if(err) {
				console.log(err);
			}
			// XXX we want this call to always succeed,
			// so we will resolve it even on error
			resolve(err);
		});
	});
};
// class methods
RFCodePort.list = function(callback) {
	// TODO implement getConnectedDevices here
};

module.exports = RFCodePort;
