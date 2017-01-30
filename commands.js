var LineByLineReader = require('line-by-line');
var fs = require('fs');
var SerialPort = require("serialport"),
	RFCodePort = require('./rfcode-port'),
	portInfo = {};

// Each command takes an Object with options and an optional progress callback.
// It should return a Promise.
var UniversalCommands = {
	// Send getPortList event to the client with the payload of all our devices connected to the port.
	getPortList: function() {
		return new Promise((resolve, reject) => {
			SerialPort.list(function(err, ports) {
				var portsList = [];
				if (err) {
					console.log('unable to get the list of ports');
					return reject(err);
				}
				// This needs to be tweaked so that we are displaying only the devices which is of interest, not all the serial ports
				ports.forEach(function(port) {
					portsList.push(port);
					console.log("port:", port);
				});
				console.log(`will send ${portsList.length} ports to ui`);
				resolve(portsList);
			});
		});
	},

	// Like getPortList, but will list only recognized RFCode devices.
	getConnectedDevices: function() {
		return new Promise((resolve, reject) => {
			console.log('getConnectedDevices');
			SerialPort.list(function(err, ports) {
				if(err) {
					console.log('Failed to list ports');
					return reject(err);
				}
				var devList = [];
				ports.forEach(function(port) {
					// it can be 'RF Code, Inc.' or 'RF_Code__Inc.'
					var manumatch = (port.manufacturer || '').match(/^RF.Code..Inc./);
					var modelmatch = (port.serialNumber || '').match(/^RF.Code..Inc..([A-Z0-9]+)$/);
					if(manumatch || modelmatch) {
						var model;
						if(modelmatch) {
							model = modelmatch[1];
						}
						console.log('Found RFCode device:', port, '\nModel:', model);
						devList.push({
							port: port.comName,
							manufacturer: port.manufacturer,
							vendorId: port.vendorId,
							productId: port.productId,
							model: model,
						});
					}
				});
				console.log('Found connected devices:', devList);
				resolve(devList);
			});
		});
	},

};

var SerialCommands = {
	// Open the serial port, for the device selected by the user.
	// If optional argument `password` passed then will login after successful opening.
	openPort: function({port, password}, callbacks) {
		// here we use "progress" callback for its "broadcast" property
		// which is just a gate for io.emit
		var already = false;
		return Promise.resolve().then(() => {
			console.log(`will try to open the path: ${port}`);
			if(portInfo[port] && portInfo[port].active) {
				// it is already opened
				// TODO: add this client's handler!?
				// to notify him if port immediately goes down
				already = true;
				return;
			} else if(portInfo[port]) {
				throw new Error('already opening this port');
			}

			portInfo[port] = new RFCodePort(port, {
				timeout: 15000,
				onclose: () => {
					// Port was closed for some reason,
					// probably device was unplugged or rebooted
					console.log(`Got close evt for port ${port} - marking inactive`);
					if(portInfo[port]) {
						callbacks.broadcast('closePort', {
							port,
							reason: 'Port was closed',
						});
						delete portInfo[port];
					}
					// else user probably already knows about this
				},
			});
			return portInfo[port].open();
		}).then(() => {
			// if port was opened successfully (or is already opened)
			// then we may want to login
			if(password) {
				return SerialCommands.deviceLogin({
					port: port,
					password: password,
				});
			}
		}).then(() => {
			// after total success, we want to return all interesting info
			var _port = portInfo[port] || {};
			var state, login;
			if(already) state = 'already opened';
			if(password) login = true;
			return {
				version: _port.version,
				model: _port.model,
				state,
				login,
			};
		}).catch(err => {
			// if something went wrong, let's clean up before returning
			if(portInfo[port]) {
				// we want to close only in the situation
				// when open() succeeded and login() failed;
				// but close() won't fail if already closed
				// so safe to call here
				return portInfo[port].close().then(() => {
					delete portInfo[port];
					// and fail with original error
					throw err;
				});
			}
			throw err;
		});
	},

	leaveBootmode: function({port}) {
		// This command should be used if device responds with E,01
		// to each command including LOGIN one.
		// Alternative is to flash new firmware.
		return portInfo[port].sendCommand('RUNAPP').then(() => {
			return 'Now the device should reboot';
		});
	},

	closePort: function({port}) {
		var thePort = portInfo[port];
		delete portInfo[port]; // to avoid duplicate notification
		return thePort.close().catch(err => {
			// restore portInfo record on failure
			portInfo[port] = thePort;
			throw err;
		});
	},

	deviceVersion: function({port}) {
		return portInfo[port].sendCommand('VER');
	},

	deviceLogin: function({port, password}) {
		return portInfo[port].sendCommand('LOGIN', [password]).catch(error => {
			throw new Error('Login failed: ' + error.message);
		});
	},

	setPassword: function({port, password}) {
		return portInfo[port].sendCommand('PWD', [password]);
	},

	// Read and return all known settings for given device
	readSettings: function({port, forSave}) {
		var result = {};
		return Promise.resolve().then(() => {
			// this one can be pre-filled
			// but we will anyway overwrite it with VER command result
			var queries = [];
			Object.keys(portInfo[port].Settings).forEach(key => {
				var settingInfo = portInfo[port].Settings[key];
				if(forSave && !(settingInfo.argTypes && settingInfo.argTypes.length)) {
					// this is a read-only setting; don't handle it in forSave mode
					return;
				}
				var prom = portInfo[port].sendCommand(settingInfo.command).then(value => {
					// at this point, value is always an array of stringified integers (or other types);
					// let's parse them
					if(value.length != settingInfo.readArgTypes.length) {
						console.log('ERROR: wrong args count', key, value);
						throw new Error(`Wrong args count for key ${key}: ${JSON.stringify(value)}`);
					} else {
						// format values with corresponding formatters
						try {
							settingInfo.readArgTypes.forEach((formatter, idx) => {
								value[idx] = formatter(value[idx]);
							});
							if(forSave && settingInfo.convertForWrite) {
								// e.g. for seg_counts
								value = settingInfo.convertForWrite(value);
							}
						} catch(e) {
							console.log('ERROR', e.stack);
							throw e;
						}
					}
					// Note: if parsing failed, we fallback to returning strings,
					// and report that problem.

					// now, if there is just one value then we want to unwrap it
					if(value.length === 1)
						value = value[0];
					result[key] = value;
				}).catch(err => {
					// something went wrong
					result[key+'__error'] = err.toString();
					result.error = err;
				});
				queries.push(prom);
			});
			return Promise.all(queries);
		}).then(() => {
			return {settings: result};
		});
	},
	
	// Write provided settings. You can provide either all settings or some of them,
	// only provided values will be written.
	// Returns separate status for each provided value.
	writeSettings: function({port, settings}) {
		if(typeof settings !== 'object')
			throw new Error('Settings should be an object');

		var results = {};
		var queries = [];
		var fail = false;
		Object.keys(settings).forEach(key => {
			var prom = Promise.resolve().then(() => {
				var cmd = portInfo[port].Settings[key].command;
				if(!cmd) {
					console.log(`WARN: unknown setting ${key}, ignoring`);
					throw new Error('Unknown parameter');
				}
				if(!portInfo[port].Settings[key].argTypes) {
					console.log(`WARN: tried to set read-only parameter ${key}`);
					throw new Error('Read-only parameter');
				}
				var val = settings[key];
				if(val instanceof Array) {
					// it is ready
				} else if(typeof val === 'object') {
					// too bad!
					console.log('WARN: got object, expected array or number:', key, ' = ', val);
					throw new Error('Invalid parameter type');
				} else {
					// wrap with array
					val = [val];
				}
				return [cmd, val];
			}).then(([cmd, args]) => {
				return portInfo[port].sendCommand(cmd, args);
			}).then(() => {
				results[key] = true;
			}).catch(error => {
				console.log(error);
				results[key] = false;
				results[key+'__error'] = error.text || error.message;
				results[key+'__code'] = error.code; // may be undefined
				fail = key;
			});
			queries.push(prom);
		});

		return Promise.all(queries).then(() => {
			if(fail) {
				// this is considered a failure
				throw {
					error: new Error('Failed to set some value(s)'),
					changed: results,
				};
			}
			// everything succeeded
			return {changed: results};
		});
	},

	resetSettings: function({port}) {
		return portInfo[port].sendCommand('INIT');
	},

	diagnostics: function({port}) {
		return portInfo[port].sendCommand(
			'DIAG', /*mode=*/'raw'
		).then(lines => {
			var regs = {
				flashWrites: /^flash writes = ([0-9]+)$/i,
				uptimeSeconds: /^seconds since reset = ([0-9]+)$/i,
				adcReading: /^ADC reading = ([0-9]+)$/i,
			};
			var ret = {};
			Object.keys(regs).forEach(key => {
				// fill with defaults
				ret[key] = null;
			});
			lines.forEach(line => {
				Object.entries(regs).forEach(([key, regexp]) => {
					var match = line.match(regexp);
					if(!match)
						return;
					// it matched! so drop it from all regexps
					delete regs[key];
					// and store result
					ret[key] = parseInt(match[1]);
				});
			});
			return ret;
		});
	},

	// File name should exist on the server.
	updateFirmware: function({port, filename}, callbacks) {
		// 0. BOOTM - switch to bootloader (unless already)
		// We should handle such situation!
		// 1. EAPP - erase flash
		// 2. PROG (several times)
		// 3. CHKAPP - checksum control
		// Suggest retry if checksum is wrong
		// 4. RUNAPP

		// TODO: report progress to the client

		var thePort = portInfo[port];

		var mkerr = (err, step) => {
			err.step = step;
			err.stack = step + ' :: ' + err.stack;
			err.message = step + ' :: ' + err.message;
			return err;
		};
		var progress = (value, step) => {
			console.log(`Progress ${value} of ${progress_max}, step ${step}`);
			callbacks.progress({
				value,
				max: progress_max,
				current_step: step,
			});
		};

		var fwstream;
		var checksum = 0;
		var bytes_sent = 0;
		var progress_max;
		var progress_fileshift = 10; // loadFile, BOOTM, 7 for 1s wait, EAPP
		var progress_end = 5; // checksum, C0, DE, checksum, RUNAPP
		var progress_filepos = 0;

		return new Promise((resolve, reject) => {
			console.log('Loading firmware image');
			progress(0, 'Preparing firmware image');

			var finfo = fs.statSync(filename);
			progress_max = finfo.size + progress_fileshift + progress_end;

			fwstream = new LineByLineReader(filename);
			fwstream.pause();
			fwstream.on('open', err => {
				if(err)
					reject(err);
				else
					resolve();
			});
		}).then(() => {
			console.log('Entering bootloader mode');
			progress(1, 'Entering bootloader mode');
			return thePort.sendCommand('BOOTM').catch(err => {
				// error code 1 means that we are already in bootloader mode
				// which is actually not a problem.
				if(err.code != 1)
					throw err;
			});
		}).then(() => {
			// After we got OK for entering bootmode,
			// bootloader is not yet completely loaded.
			// If we issue EAPP immediately, we will get E,01 (cmd not found).
			// To avoid that, we have to wait for about 1 second,
			// as implemented in the original app.
			progress(2, 'Waiting for the bootloader');
			return new Promise(resolve => setTimeout(resolve, 1000));
		}).then(() => {
			console.log('Erasing app memory');
			progress(9, 'Erasing flash memory');
			return thePort.sendCommand('EAPP');
		}).then(() => {
			return new Promise((resolve, reject) => {
				// now attach handlers and unpause input stream

				var toHex = function(value, length) {
					var hex = value.toString(16);
					// now pad it with zeros
					while(hex.length < length)
						hex = '0' + hex;
					if(hex.length > length) {
						console.log(`WARN: number too large - ${hex} > ${length} digits; trimming`);
						hex = hex.slice(hex.length - length);
					}
					return hex.toUpperCase();
				};
				var handleLine = function(line) {
					// first of all, pause immediately as we want to handle this line first
					fwstream.pause();

					progress(progress_fileshift + progress_filepos, 'Uploading firmware data');
					progress_filepos += line.length + 2; // account for CR and LF
					// FIXME: if the file has only CR's or only LF's, progress meter will exceed the boundaries
					if(progress_fileshift + progress_filepos > progress_max - progress_end) {
						// workaround for that: increase maximum in such situations
						console.log('WARN probably CR/LF problem');
						progress_max = progress_fileshift + progress_filepos - progress_end;
					}

					var next = function() {
						// allow receiving next event, be it line or end
						fwstream.resume();
					};

					// now let's parse it
					line = line.trim();
					if(!line || line[0] != ':' || line.length < 11) {
						console.log(`NOTICE unrecognized line ${line}`);
						next();
						return;
					}

					// convert hex digits to bytes
					var bytes;
					try {
						bytes = new Buffer(line.substr(1), 'hex');
					} catch(err) {
						console.log(`ERROR bad line ${line}`);
						return reject(mkerr(err, 'Incorrect HEX file'));
					}

					// check current line's checksum
					var sum = bytes.reduce((a, b) => (a+b) & 0xFF);
					if(sum !== 0) {
						console.log(`ERROR wrong checksum ${sum} for line ${line}`);
						return reject(new Error('Wrong line checksum'));
					}

					var rec = {
						dataBytes: bytes.readUInt8(0),
						addr: bytes.readUInt16BE(1),
						type: bytes.readUInt8(3),
						data: bytes.slice(4, -1),
						// last byte is the checksum, we already checked it
					};
					if(rec.dataBytes != rec.data.length) {
						console.log('ERROR wrong data bytes count');
						return fail(new Error('Wrong data bytes count'));
					}

					if(rec.type === 0) {
						// data record
						// send it to the device and fetch next line afterwards
						sendChunk(rec.addr, rec.data, next);
					} else if(rec.type == 1) {
						// end of file record
						// so we don't longer want to raise error on EOF
						fwstream.removeListener('end', handleEOF);
						// and can close stream
						fwstream.close();

						resolve(); // this step is done, move to next
					} else {
						console.log(`WARN unsupported record type ${rec.type}`);
						next();
					}
				};
				var handleEOF = function() {
					reject(new Error('Unexpected end of firmware file'));
				};
				var sendChunk = function(addr, data, done) {
					// send one chunk to the device and call a callback when done
					console.log(`Sending chunk at address ${addr}`);
					var size = data.length;
					thePort.sendCommand('PROG', [
						toHex(addr, 4), // address
						toHex(size, 2), // bytecount
						data.toString('hex').toUpperCase(), // data
					], err => {
						if(err) {
							return reject({
								error: mkerr(err, `sendChunk ${addr}`),
								suggestRetry: true,
							});
						}
						// now that chunk is sent, we want to apply its data
						// to the checksum
						data.forEach(b => checksum += b);
						checksum &= 0xFFFF;
						bytes_sent += size;
						// flash next chunk, if any, or continue to validation
						done();
					});
				};

				fwstream.on('error', err => {
					fwstream.pause();
					fwstream.close();
					reject(err);
				});
				fwstream.on('line', handleLine);
				fwstream.on('end', handleEOF);
				fwstream.resume();
			});
		}).then(() => {
			var validateChecksum = function() {
				console.log('Validating checksum');
				// we want to "finalize" checksum by appending 0xFF
				// for each non-flashed byte
				var flashSize = thePort.Constants.flashEnd - thePort.Constants.flashStart;
				var finalSum = checksum;
				if(bytes_sent < flashSize) {
					finalSum += 0xFF * (flashSize - bytes_sent);
					finalSum &= 0xFFFF;
				} else {
					console.log('WARNING: flashed the whole memory?? or even more?');
				}

				return thePort.sendCommand('CHKAPP').then(value => {
					if(value != toHex(finalSum)) {
						console.log('Checksum mismatch: '+value+' != '+toHex(checksum));
						throw {
							error: new Error('Checksum mismatch'),
							suggestRetry: true,
						};
					}
				}).catch(err => {
					throw {
						error: mkerr(err, 'validateChecksum'),
						suggestRetry: true,
					};
				});
			};

			progress(progress_max-5, 'Validating checksum');
			// before finalizing flashing process
			// by writing 0xC0DE at the end of memory,
			// we want to validate that everything else
			// was written properly.
			validateChecksum().then(() => {
				progress(progress_max-4, 'Finalizing flash memory');
				// now that checksum is known valid,
				// let's write finalizing 0xC0DE word to the end of memory
				// and then validate everything again
				// before rebooting
				var addr = thePort.Constants.flashEnd-2;
				var c0de = new Buffer('C0DE', 'hex');
				return sendChunk(addr, c0de);
			}).then(() => {
				progress(progress_max-2, 'Validating checksum');
				// now that c0de is written,
				// let's validate checksum again
				// and then reboot device.
				return validateChecksum();
			});
		}).then(() => {
			console.log('Rebooting device');
			progress(progress_max-1, 'Rebooting device');
			return thePort.sendCommand('RUNAPP').then(() => {
				progress(progress_max, 'Firmware upgrade succeeded, please reopen port');
			});
		});
	},

	/// Below are model-specific commands,
	// but they will "properly" fail on incompatible device
	
	// A740 only
	calibrationStart: function({port}) {
		return portInfo[port].sendCommand('CAL', [1]);
	},
	// A740 only
	calibrationStatus: function({port}) {
		return portInfo[port].sendCommand('CAL').then(ret => {
			if(ret.length === 0) {
				return {
					calibrationRunning: true,
				};
			}
			if(ret.length % 10 !== 0) {
				throw new Error(`Wrong values count: ${ret.length}`);
			}
			var banksCount = ret.length / 10;
			var banks=[];
			for(let i=0; i<banksCount; i++) {
				banks[i] = [];
				for(let j=0; j<ret.length; j+=banksCount) {
					banks[i].push(ret[j+i]);
				}
			}
			return {
				calibrationRunning: false,
				banksCount,
				banks,
			};
		});
	},

	// A750 only
	readInfraRed: function({port}) {
		return portInfo[port].sendCommand(
			'RIR', /*mode=*/'multiple'
		).then(responses => {
			var ret = [];
			responses.forEach(resp => {
				// first of all, convert them all to numbers
				resp = resp.map(Number);
				var [rxslot, protocol, location, teamstatus] = resp;
				var peers_seen = teamstatus & ((1<<8)-1);
				var peers_seen_slots = [];
				for(let i=0; i<8; i++) {
					if(peers_seen & (1 << i))
						peers_seen_slots.push(i);
				}
				var hopcount = teamstatus >> 8 & ((1<<5)-1);
				var timeslot = teamstatus >> 13 & ((1<<3)-1);
				ret.push({
					rxslot, protocol, location,
					_teamstatus: teamstatus,
					peers_seen: {
						mask: peers_seen,
						slots: peers_seen_slots,
					},
					hopcount, timeslot,
				});
			});
			return {
				results: ret,
			};
		});
	},
};
var BleCommands = {
};

// Validate arguments for commands, based on arg name.
// Each validator might raise error.
// TODO: maybe just return value, to allow multi-validation?
var ArgumentValidators = {
	port: function(port, cmd) {
		if(!port) {
			throw new Error('No port name provided');
		}
		if(cmd == 'openPort') {
			// special case - don't validate value for this command,
			// except for value presence
			return;
		}
		if(!portInfo[port]) {
			throw new Error(`Port not opened: ${port}`);
		}
		if(!portInfo[port].active) {
			throw new Error(`Port not active: ${port}`);
		}
	},
};

// Helper methods for easy access to these above objects
var listAllCommands = function() {
	// Return list of all known command names
	var names = [];
	[UniversalCommands, SerialCommands, BleCommands].forEach(list => {
		Object.keys(list).forEach(name => {
			if(names.indexOf(name) < 0) {
				names.push(name);
			}
		});
	});
	return names;
};
var dispatchCommand = function(name, args) {
	// determine whether this command is for Serial, BLE or common
	args = args || {};
	var ser = SerialCommands[name];
	var ble = BleCommands[name];
	var univ= UniversalCommands[name];
	if(ser && !ble && !univ) {
		return ser;
	} else if(!ser && ble && !univ) {
		return ble;
	} else if(!ser && !ble && univ) {
		return univ;
	}

	// ambiguous name -> try to auto-detect
	if(ser && args.port) {
		// Serial
		return ser;
	} else if(ble && args.mac) {
		// BLE
		return ble;
	} else if(univ) {
		// agnostic
		return univ;
	} else if(ser || ble) {
		// use any remaining
		return ser || ble;
	} else {
		// should never happen...
		throw new Error('Unknown command');
	}
};

module.exports = {
	ArgumentValidators,
	dispatchCommand,
	listAllCommands,
	portInfo, // for debugging
};
