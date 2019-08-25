#!/bin/env node
// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 4 -*-

var vm_debugging = process.env['DEBUG'] == '1';

const LOAD_OFFSET = 1024;

require('vm');
const RAM = require('vm/devices/ram');
const Timer = require('vm/devices/timer');
const RTC = require('vm/devices/rtc');
const DevConsole = require('vm/devices/console');
const OutputStream = require('vm/node/devices/output_stream');
const InputStream = require('vm/node/devices/input_stream');
const KeyStore = require('vm/devices/keystore.js');
const KeyValueHTTP = require('key_value/http');
const KeyValueFS = require('key_value/file_system');
const Fetch = require('node-fetch');

function vm_init(ram_size)
{
    if(ram_size == null) ram_size = 8 * 1024 * 1024;
    
    vm = new VM.Container();

    var mem = new VM.MemoryBus();
    var cpu = new VM.CPU(mem, ram_size);
    mem.map_memory(0x0, ram_size, new RAM(ram_size));

    var devcon_addr = 0xF0001000;
    var devcon = new DevConsole();
    mem.map_memory(devcon_addr, devcon.ram_size(), devcon);

    var output_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 3);
    var output_addr = 0xF0003000;
    var output = new OutputStream(process.stdout, null, output_irq);
    mem.map_memory(output_addr, output.ram_size(), output);

    var input_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 4);
    var input_addr = 0xF0004000;
    var input = new InputStream(process.stdin, null, input_irq);
    mem.map_memory(input_addr, input.ram_size(), input);

    var stderr_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 5);
    var stderr_addr = 0xF0005000;
    var stderr = new OutputStream(process.stderr, null, stderr_irq);
    mem.map_memory(stderr_addr, stderr.ram_size(), stderr);

    var timer_addr = 0xF0002000;
    var timer_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 2);
    var timer = new Timer(timer_irq, 1<<20);
    mem.map_memory(timer_addr, timer.ram_size(), timer);

    var rtc_addr = 0xF0006000;
    var rtc = new RTC();
    mem.map_memory(rtc_addr, rtc.ram_size(), rtc);

    var http_store = new KeyValueHTTP(Fetch);
    var http_storage_addr = 0xF000B000;
    var http_storage_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 10);
    var http_storage = new KeyStore(http_store, mem, http_storage_irq);
    mem.map_memory(http_storage_addr, http_storage.ram_size(), http_storage);
  
    var fs_store = new KeyValueFS(Fetch);
    var fs_storage_addr = 0xF000D000;
    var fs_storage_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 12);
    var fs_storage = new KeyStore(fs_store, mem, fs_storage_irq);
    mem.map_memory(fs_storage_addr, fs_storage.ram_size(), fs_storage);
  
    vm.add_device(mem)
          .add_device(cpu)
          .add_device(devcon)
          .add_device(output)
          .add_device(input)
          .add_device(timer)
          .add_device(rtc)
          .add_device(http_storage)
          .add_device(fs_storage);

    vm.info = {
        /*
        keyboard: {
            addr: keyboard_addr,
            irq: keyboard_irq
        },
*/
        console: {
            addr: devcon_addr
        },
        timer: {
            addr: timer_addr,
            irq: timer_irq
        },
        rtc: {
            addr: rtc_addr
        },
        input: {
            addr: input_addr,
            irq: input_irq
        },
        output: {
            addr: output_addr,
            irq: output_irq
        },
        http_storage: {
          addr: http_storage_addr,
          irq: http_storage_irq.toInt()
        },
        fs_storage: {
          addr: fs_storage_addr,
          irq: fs_storage_irq.toInt()
        }
    };

	return vm;
}

if(typeof(module) != 'undefined') {
	module.exports = {
		vm_init: vm_init
	};
}

const fs = require('fs');

if(vm_debugging) console.log("Initializing...");

var vm = vm_init();

function exit_check(max_steps)
{
    if(vm.cpu == null || !vm.cpu.halted) return;
    if(max_steps && vm.cycles < max_steps) return;
    
    if(vm_debugging) {
        var t = (Date.now() - start_time);
        console.log("" + vm.cpu.cycles + " steps in " + t + "ms");
    }

    process.exit(vm.cpu.regread(0));
}

function main_loop(vm, max_steps, debugging)
{
    var t = Date.now();
    if(vm_debugging) console.log("Tick", t, vm.cpu.cycles, vm.cpu.stepping, steps, max_steps);

    if(debugging) {
		vm.dbstep(max_steps);
    } else {
        vm.run();
    }

    setInterval(exit_check, 100, max_steps);
}

var args = process.argv;
var path = args[2];
var steps = parseInt(args[3]);
if(isNaN(steps) || steps <= 0) steps = null;
else console.log("Stepping for " + steps);

var start_time = Date.now();

if(vm_debugging) {
    vm.debug = 1;
    vm.each_device(function(dev) {
        dev.debug = 1;
    });
}

if(path != null && path != ':echo') {
    if(vm_debugging) console.log("Loading " + path);
	  fs.readFile(path, function(err, data) {
		    if(err) throw err;
		    vm.cpu.memwrite(0, data);
        if(vm_debugging) {
            console.log("Wrote " + data.length + " bytes to memory");
        }

        main_loop(vm, steps, steps != null);
	  });
} else {
  const BootLoader = require('vm/boot_loader.js');
  var boot_loader = BootLoader.assemble(1024*1024, 0, vm.info);
  vm.cpu.memwrite(0, boot_loader);
  main_loop(vm, steps, steps != null);
}
