// Factory for hex string validator
var HexString = function(nchars) {
	return function(val) {
		if(typeof val !== 'string')
			throw new TypeError(`String expected, got ${val}`);
		if(val.length != nchars)
			throw new Error(`Wrong string length, expected ${nchars} chars, got string ${val}`);
		val = val.toUpperCase();
		if(!val.match(/^[0-9A-F]+$/))
			throw new Error(`Not a valid hexadecimal value ${val}`);
		return val;
	};
};
var RangeNumber = function(min, max) {
	return function(val) {
		val = Number(val);
		if(isNaN(val))
			throw new TypeError('Not a valid number');
		if(val < min)
			throw new Error(`Value too small - ${val}`);
		if(val > max)
			throw new Error(`Value too large - ${val}`);
		return val;
	};
};

// TODO: rework this module to have better structure,
// merge settings & errors on per-model basis?
var SettingsAvailable = {
	// map known setting names to their commands, per device model.
	// also includes information about argument types.
	'common': {
		version: ['VER', false, [String]], // false means this value is read-only
		location: ['LOC', [Number]],
		active_protocol: ['IRP', [Number]],
		brightness: ['BRT', [Number]],
		beam_pattern: ['PAT', [HexString(4)]],
		serial: ['SN', [String]],
		duty_cycle: ['DC', [RangeNumber(0, 83)]],
	},
	'A740': {
		seg_counts: ['SEG',
			[Number, Number],
			// this is a format of data received from device,
			// contrary to data sent with command
			[Number, Number, Number, Number, Number, Number],
			// conversion helper
			function(val) {
				// val is an array of 6 numbers
				return val.slice(0, 2);
			},
		],
	},
	'A750': {
		slot_id: ['S', [RangeNumber(0, 7)]],
	},
};
var ErrorCodes = {
	'common': {
		1: 'Invalid or unsupported command',
		2: 'Command has too many parameters',
		3: 'Command has too few parameters',
		4: 'Command parameter is invalid',
		5: 'Command buffer overflow',
		6: 'Access denied',
		7: 'Parameter out of range',
	},
	'A740': {
		20: 'VPP too low to attempt calibration',
	},
	'A750': {},
};

var settingsForModel = function(model) {
	if(!SettingsAvailable[model]) {
		throw new Error(`Unsupported model ${model}`);
	}
	var result = {};
	['common', model].forEach(grp => {
		Object.keys(SettingsAvailable[grp]).forEach(key => {
			var [cmd, args, readargs, convert] = SettingsAvailable[grp][key];
			readargs = readargs || args; // defaults to args if not provided
			result[key] = {
				command: cmd,
				argTypes: args,
				readArgTypes: readargs,
				convertForWrite: convert,
			};
		});
	});
	return result;
};
var errorsForModel = function(model) {
	if(!ErrorCodes[model])
		throw new Error(`Unsupported model ${model}`);
	var result = {};
	['common', model].forEach(grp => {
		Object.keys(ErrorCodes[grp]).forEach(code => {
			result[code] = ErrorCodes[grp][code];
		});
	});
	result.getMessage = function(code) {
		return result[code] || result[parseInt(code)] || 'Unknown error';
	};
	result.format = function(code) {
		var message = result.getMessage(code);
		return 'Error '+code+': '+message;
	};
	return result;
};

module.exports = {
	settingsForModel,
	errorsForModel,
};
