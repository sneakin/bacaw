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

function vm_init(ram_size)
{
    if(ram_size == null) ram_size = 8 * 1024 * 1024;
    
    vm = new VM.Container();

    var mmu = new VM.MMU();
    var cpu = new VM.CPU(mmu, ram_size);
    mmu.map_memory(0x0, ram_size, new RAM(ram_size));

    var devcon = new DevConsole();
    mmu.map_memory(0xF0001000, devcon.ram_size(), devcon);

    var output_irq = VM.CPU.INTERRUPTS.user;
    var output = new OutputStream(process.stdout, null, vm, output_irq);
    mmu.map_memory(0xF0003000, output.ram_size(), output);

    var input_irq = VM.CPU.INTERRUPTS.user + 1;
    var input_addr = 0xF0004000;
    var input = new InputStream(process.stdin, null, vm, input_irq);
    mmu.map_memory(input_addr, input.ram_size(), input);

    var timer_addr = 0xF0002000;
    var timer_irq = VM.CPU.INTERRUPTS.user + 2;
    var timer = new Timer(vm, timer_irq, 1<<20);
    mmu.map_memory(timer_addr, timer.ram_size(), timer);

    var rtc_addr = 0xF0005000;
    var rtc = new RTC();
    mmu.map_memory(rtc_addr, rtc.ram_size(), rtc);

    vm.add_device(mmu)
          .add_device(cpu)
          .add_device(devcon)
          .add_device(output)
          .add_device(input)
          .add_device(timer)
          .add_device(rtc);

	vm.info = {
		keyboard_addr: input_addr,
		keyboard_irq: input_irq,
		timer_addr: timer_addr,
		timer_irq: timer_irq,
		rtc_addr: rtc_addr,
		rtc_irq: rtc_irq,
        input_irq: input_irq,
        output_irq: output_irq
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

if(path != null) {
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
    const Forth = require("forth");

    function forth_init(vm)
    {
        program_code = Forth.assemble(vm.info.keyboard_addr, vm.info.keyboard_irq, vm.info.timer_addr, vm.info.timer_irq);
        vm.cpu.memwrite(LOAD_OFFSET, program_code); // todo ISR is at 0
    }

	forth_init(vm);
    main_loop(vm, steps, steps != null);
}
