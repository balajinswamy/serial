#Generic Implementation -NodeJS, Express, SerialPort, socket.io

# IOT USB connected Devices

## How to use the test-client.js - A rich alternative to wscat with support for socket.io protocol.
    I manually execute commands from it, and observe results as well as logs from the main rfcSerial program which is launched in another terminal window.


### 
List of available commands:
    getPortList,
    getConnectedDevices,
    openPort,
    leaveBootmode,
    closePort,
    deviceVersion,
    deviceLogin,
    setPassword,
    readSettings,
    writeSettings,
    resetSettings,
    diagnostics,
    updateFirmware,
    calibrationStart,
    calibrationStatus,
    readInfraRed

Each command takes an Object with options and an optional progress callback. It should return a Promise.

getPortList: function () //Send getPortList event to the client with the payload of all the devices connected to the USB port.
```
    Ex: getPortList
    Got event: getPortList
    [ { comName: '/dev/cu.Bluetooth-Incoming-Port' },
      { comName: '/dev/cu.balajinsiPhone-Wireless' } ]
```

getConnectedDevices //Like getPortList, but will list only your organizations recognized devices.
```
    Ex: getConnectedDevices
    Got event: getConnectedDevices
    [ { port: '/dev/cu.usbmodemFA131',
        manufacturer: 'Your Manufactuer, Inc.',
        vendorId: '0x1c40',
        productId: '0x05f2' } ]
```

openPort: function ({port, password}) //Open the serial port, for the device selected by the user. If optional argument `password` passed then will login after successful opening.
```
    Ex: openPort port=/dev/cu.usbmodemFA131
    Got event: openPort
    { version: 'AIOT:V1.10:20130703_110854_P',
      model: 'AIOT',
      port: '/dev/cu.usbmodemFA131',
      success: true }

    Ex: openPort port=/dev/cu.usbmodemFD121 password=balajin
    Got event: openPort
    { version: 'AIOT:V1.10:20130703_110854_P',
      model: 'AIOT',
      login: true,
      port: '/dev/cu.usbmodemFD121',
      success: true }
```

deviceLogin: function ({port, password}) //Login to secure mode with correct password 
```
    Ex: deviceLogin port=/dev/cu.usbmodemFA131 password=devicePassword
    
    //Failure
    Got event: deviceLogin
    { port: '/dev/cu.usbmodemFA131',
      success: false,
      error: 'Error: Login failed: Error 6: Access denied',
      stack: 'Error: Login failed: Error 6: Access denied\n    at portInfo.(anonymous function).sendCommand.catch.error (/Users/balajin/IOT/rfcSerial/commands.js:166:10)\n    at process._tickCallback (internal/process/next_tick.js:103:7)' }
    
    //Success
    Got event: deviceLogin
    { port: '/dev/cu.usbmodemFA131', success: true }
```

deviceVersion: function ({port}) 
```
    Ex: deviceVersion port=/dev/cu.usbmodemFA131
    Got event: deviceVersion
    [ 'AIOT:V1.10:20130703_110854_P' ]
```

leaveBootmode: function ({port}) //This command should be used if device responds with E,01 to each command including LOGIN one. Alternative is to flash new firmware.

resetSettings: function ({port}, progress) //Read and return all known settings for the given device
``` 
    Ex: resetSettings port=/dev/cu.usbmodemFA131
    Got event: readSettings
    { settings: 
       { version: 'AIOT:V1.10:20130703_110854_P',
         location: 1,
         active_protocol: 2,
         brightness: 4,
         beam_pattern: '0003',
         serial: '0131500NK00035',
         duty_cycle: 41,
         seg_counts: [ 0, 0, 0, 0, 3, 3 ] },
      port: '/dev/cu.usbmodemFA131',
      success: true } 
```
setPassword: function ({port, password})  //This command is used to set the case-sensitive password used to login to secure mode. This setting is a nonvolatile parameter.
```
    Ex: setPassword port=/dev/cu.usbmodemFA131 password=yourPassword
```

updateFirmware: function ({port, filename}, progress_cb) --not tested

writeSettings: function ({port, settings}) //Write provided settings. You can provide either all settings or some of them, only provided values will be written. 
Note: Returns separate status for each provided value.

closePort: function ({port}) 
```
    Ex: closePort port=/dev/cu.usbmodemFA131
    Got event: closePort
    { result: null, port: '/dev/cu.usbmodemFA131', success: true }
```

###
AIOT1 only
calibrationStart: function({port})
calibrationStatus: function({port})
###

###
AIOT2 Only
readInfraRed: function({port})
###

var modelmatch = (port.manufacturer || '').match(/^ManufacturerName..Inc.+$/);

BLE connected Devices
## coming soon...

