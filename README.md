closePort: function ({port}) closePort port=/dev/cu.usbmodemFD121
deviceLogin: function ({port, password}) deviceLogin port=/dev/cu.usbmodemFD121 password=RFCODE
deviceVersion: function ({port}) { deviceVersion port=/dev/cu.usbmodemFD121
getConnectedDevices getConnectedDevices
getPortList: function () 
leaveBootmode: function ({port}) {
openPort: function ({port, password}) openPort port=/dev/cu.usbmodemFD121

readSettings: function ({port}, progress) -- not working UnhandledPromiseRejectionWarning: Unhandled promise rejection (rejection id: 2): TypeError: args.join is not a function
			if(args.length) {
				fullcmd += ',';
				fullcmd += args.join(','); //line 134 rfcode-port.js
			}

resetSettings: function ({port}) --not tested

setPassword: function ({port, password})  setPassword port=/dev/cu.usbmodemFD121 password=balajin
updateFirmware: function ({port, filename}, progress_cb) --not tested
writeSettings: function ({port, settings}) --not tested

var modelmatch = (port.manufacturer || '').match(/^RF.Code..Inc.+$/);