#!/usr/bin/env node

var io = require('socket.io-client')
var socket = io('ws://localhost:8081/')
var readline = require('readline')

// From http://stackoverflow.com/a/33960032/2267932
// Support catch-all custom events with *
var onevent = socket.onevent
socket.onevent = function(packet) {
	var args = packet.data || []
	onevent.call(this, packet) // original call
	packet.data = ['*'].concat(args)
	onevent.call(this, packet) // additional call for catch-all
}

socket.on('*', (evt, data) => {
	readline.cursorTo(process.stdout, 0)
	console.log('Got event:', evt)
	typeof data !== 'undefined' && console.log(data)
	rl.prompt()
})

var rl = readline.createInterface(process.stdin, process.stdout)
rl.write('Ready.\n')
rl.prompt()
rl.on('line', line => {
	let [cmd, ...args] = line.split(' ')
	if(!cmd) {
		rl.prompt()
		return
	}
	let map = {}
	args.forEach(arg => {
		if(!arg)
			return;
		let [left, right] = arg.split('=')
		if(typeof right === 'undefined') {
			right = true
		} else {
			try {
				right = JSON.parse(right);
			} catch(err) {}
		}
		map[left] = right
	})
	socket.emit(cmd, map)
	rl.prompt()
}).on('close', () => {
	socket.close()
})
