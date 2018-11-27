const util = require('util.js');
const vmjs = require('vm.js');
const RAM = require('vm/devices/ram.js');
const Keyboard = require('vm/devices/keyboard.js');
const Console = require('vm/devices/console.js');
const GFX = require('vm/devices/gfx.js');
const Timer = require('vm/devices/timer.js');

var vm, cpu, keyboard;
var main_window, second_window;

function runner_init(width, height, load_offset, mem_size, callbacks)
{
  if(mem_size == null) {
    mem_size = 8 * 1024 * 1024;
  }
  
    if(width == null) {
        width = window.innerWidth;
    }
    if(height == null) {
        height = window.innerHeight;
    }
    if(load_offset == null) load_offset = 0;

    console.log("Initializing...");
    
	  main_window = document.getElementById("main_window");
	  main_window.width = width;
	  main_window.height = height;

    second_window = document.getElementById('second_window');
    second_window.width = width;
    second_window.height = height;

    var vm = new VM.Container(callbacks);
    if(typeof(window) != 'undefined') window.vm = vm;

    mmu = new VM.MMU();
  	//cpu = new VM.CPU(mmu, 1<<16);
  //mmu.map_memory(0, 0x2, new RAM(0x2));
    //  mmu.map_memory(0x2, 0x10000, new RAM(0x10000 - 0x2));
    mmu.map_memory(0, 4096, new RAM(4096));
	  cpu = new VM.CPU(mmu, mem_size);
    mmu.map_memory(4096, mem_size - 4096, new RAM(mem_size - 4096));

    var keyboard_irq = VM.CPU.INTERRUPTS.user;
    var keyboard_addr = 0xF0004000;
    keyboard = new Keyboard(window, vm, keyboard_irq);
    mmu.map_memory(keyboard_addr, keyboard.ram_size(), keyboard);
    
    var devcon = new Console();
    var devcon_addr = 0xF0001000;
    mmu.map_memory(devcon_addr, devcon.ram_size(), devcon);

  var unscii_font = new Image();
  unscii_font.src = "images/unscii-16.png";
  var unscii8_font = new Image();
  unscii8_font.src = "images/unscii-8.png";
  
    var gfx_mem_size = 16*1024;
    var gfx_irq = VM.CPU.INTERRUPTS.user + 1;
    video = new GFX(vm, gfx_irq, [ main_window, second_window ], width, height, gfx_mem_size, width, height, [ unscii_font, unscii8_font ]);
    var gfx_addr = 0xF0010000;
    var gfx_input_addr = gfx_addr + video.input_struct.fields['input'].offset;
    gfx_swap_addr = gfx_addr + video.input_struct.fields['swap'].offset;
    mmu.map_memory(gfx_addr, video.ram_size(), video);

    var timer_addr = 0xF0002000;
    var timer_irq = VM.CPU.INTERRUPTS.user + 2;
    var timer = new Timer(vm, timer_irq, 1<<20);
    mmu.map_memory(timer_addr, timer.ram_size(), timer);
    
    vm.add_device(mmu)
        .add_device(cpu)
        .add_device(devcon)
        .add_device(keyboard)
        .add_device(video)
      .add_device(timer);

  vm.info = {
    gfx: {
      width: width,
      height: height,
      mem_size: gfx_mem_size,
      addr: gfx_input_addr,
      swap_addr: gfx_swap_addr,
      irq: gfx_irq
    },
    keyboard: {
      addr: keyboard_addr,
      irq: keyboard_irq
    },
    console: {
      addr: devcon_addr
    },
    timer: {
      addr: timer_addr,
      irq: timer_irq
    }
  };
  
  return vm;
}

if(typeof(module) != 'undefined') {
	module.exports = {
		init: runner_init
	};
}

if(typeof(window) != 'undefined') {
	window.runner_init = runner_init;
}
