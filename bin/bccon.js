#!/bin/env node
// -*- mode: JavaScript; coding: utf-8-unix -*-

var vm_debugging = process.env['DEBUG'] == '1';

const LOAD_OFFSET = 1024;

require('vm');
const RAM = require('vm/devices/ram');
const Timer = require('vm/devices/timer');
const DevConsole = require('vm/devices/console');
const OutputStream = require('vm/node/devices/output_stream');
const InputStream = require('vm/node/devices/input_stream');

function vm_init(ram_size)
{
    if(ram_size == null) ram_size = 8 * 1024 * 1024;
    
    var mmu = new VM.MMU();
    var cpu = new VM.CPU(mmu, ram_size);
    mmu.map_memory(0x0, ram_size, new RAM(ram_size));

    var devcon = new DevConsole();
    mmu.map_memory(0xF0001000, devcon.ram_size(), devcon);

    var output_irq = VM.CPU.INTERRUPTS.user;
    var output = new OutputStream(process.stdout, null, cpu, output_irq);
    mmu.map_memory(0xF0003000, output.ram_size(), output);

    var input_irq = VM.CPU.INTERRUPTS.user + 1;
    var input_addr = 0xF0004000;
    var input = new InputStream(process.stdin, null, cpu, input_irq);
    mmu.map_memory(input_addr, input.ram_size(), input);

    var timer_addr = 0xF0002000;
    var timer_irq = VM.CPU.INTERRUPTS.user + 2;
    var timer = new Timer(cpu, timer_irq, 1<<20);
    mmu.map_memory(timer_addr, timer.ram_size(), timer);

    vm = new VM.Container();
    vm.add_device(mmu)
        .add_device(cpu)
        .add_device(devcon)
        .add_device(output)
        .add_device(input)
        .add_device(timer);

	  vm.info = {
		    keyboard_addr: input_addr,
		    keyboard_irq: input_irq,
		    timer_addr: timer_addr,
		    timer_irq: timer_irq,
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
//const fs = require('fs');

var vm = vm_init();
var args = process.argv;
var path = args[2];
var steps = parseInt(args[3]);
if(isNaN(steps) || steps <= 0) steps = null;
else console.log("Stepping for " + steps);

var interval;
//var steps_per_sec = 1000000;
//var steps_per_sec = 10;
//var steps_per_ms = steps_per_sec * 1000;;
var initial_steps_per_ms = 10000;
var target_steps_per_ms = 1000;
var start_time = Date.now();
var sleep_delay = 1000; //ms

if(vm_debugging) {
  vm.each_device(function(dev) {
    dev.debug = true;
  });
}

function main_loop(vm, steps, max_steps)
{
  var t = Date.now();
  if(vm_debugging) console.log("Tick", t, vm.cpu.cycles, vm.cpu.stepping, steps, max_steps);
  if(!steps || Math.abs(steps) > initial_steps_per_ms) steps = initial_steps_per_ms;

  if(!vm.cpu.stepping) {
    if(max_steps) {
			vm.dbstep(steps);
    } else {
      vm.run(steps);
    }
  }

  if(vm.cpu.running
     && !vm.cpu.halted
     && (max_steps == null || vm.cpu.cycles < max_steps)) {
    var delay = 1;
    if((vm.cpu.regread('status') & VM.CPU.STATUS.SLEEP) != 0) delay = sleep_delay;

    if(vm_debugging) {
      var dt = Date.now() - t;
      var num_steps_dt = steps / dt;
      console.log("Ticking: ", steps, "target steps/ms", vm.cpu.cycles, "cycles", dt, "ms", num_steps_dt, "steps/ms", delay, "ms delay");
    }

    interval = setInterval(function() { main_loop(vm, steps, max_steps); }, delay);
  } else {
    if(vm_debugging) {
      var t = (Date.now() - start_time);
      console.log("" + vm.cpu.cycles + " steps in " + t + "ms");
    }
    process.exit(vm.cpu.regread(0));
  }
}

if(path != null) {
  if(vm_debugging) console.log("Loading " + path);
		fs.readFile(path, function(err, data) {
			  if(err) throw err;
			  vm.cpu.memwrite(0, data);
        if(vm_debugging) {
          console.log("Wrote " + data.length + " bytes to memory");
        }

        main_loop(vm, initial_steps_per_ms, steps);

      //if((vm.cpu.regread('status') & VM.CPU.STATUS.SLEEP) == 0) {
      //process.exit(0);
      //}
		});
} else {
  const Forth = require("forth");

  function forth_init(vm)
  {
    program_code = Forth.assemble(vm.info.keyboard_addr, vm.info.keyboard_irq, vm.info.timer_addr, vm.info.timer_irq);
    vm.cpu.memwrite(LOAD_OFFSET, program_code); // todo ISR is at 0
  }

	forth_init(vm);
	vm.dbstep(steps);
}
