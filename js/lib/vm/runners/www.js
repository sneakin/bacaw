// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 4 -*-

const util = require('util.js');
const vmjs = require('vm.js');
const RAM = require('vm/devices/ram.js');
const Keyboard = require('vm/devices/keyboard.js');
const Console = require('vm/devices/console.js');
const GFX = require('vm/devices/gfx.js');
const Timer = require('vm/devices/timer.js');
const RTC = require('vm/devices/rtc.js');
const KeyStore = require('vm/devices/keystore.js');
const KeyValue = require('key_value');
const Sound = require("vm/devices/sound.js");

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

    var mem = new VM.MemoryBus();
    // To have a memory division:
    // mem.map_memory(0, 4096, new RAM(4096));
    // mem.map_memory(4096, mem_size - 4096, new RAM(mem_size - 4096));

    mem.map_memory(0, mem_size, new RAM(mem_size));
	  cpu = new VM.CPU(mem, mem_size);
	//var cpu2 = new VM.CPU(mem, mem_size);
  //cpu2.set_status(VM.CPU.STATUS.SLEEP);
  
    var keyboard_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 5);
    var keyboard_addr = 0xF0005000;
    keyboard = new Keyboard(main_window, keyboard_irq);
    mem.map_memory(keyboard_addr, keyboard.ram_size(), keyboard);
    
    var devcon = new Console();
    var devcon_addr = 0xF0001000;
    mem.map_memory(devcon_addr, devcon.ram_size(), devcon);

  var unscii_font = new Image();
  unscii_font.src = "images/unscii-16.png";
  var unscii8_font = new Image();
  unscii8_font.src = "images/unscii-8.png";
  
    var gfx_mem_size = 16*1024;
    var gfx_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 16);
    video = new GFX(gfx_irq, [ main_window, second_window ], width, height, gfx_mem_size, width, height, [ unscii_font, unscii8_font ]);
    var gfx_addr = 0xF0010000;
    var gfx_input_addr = gfx_addr + video.input_struct.fields['input'].offset;
    gfx_swap_addr = gfx_addr + video.input_struct.fields['swap'].offset;
    mem.map_memory(gfx_addr, video.ram_size(), video);

    var timer_addr = 0xF0002000;
    var timer_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 2);
    var timer = new Timer(timer_irq, 1<<20);
    mem.map_memory(timer_addr, timer.ram_size(), timer);

    var rtc_addr = 0xF0006000;
    var rtc = new RTC();
    mem.map_memory(rtc_addr, rtc.ram_size(), rtc);

    var local_store = new KeyValue.Storage(localStorage);
    var local_storage_addr = 0xF0007000;
    var local_storage_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 6);
    var local_storage = new KeyStore(local_store, mem, local_storage_irq, 'LocalStorage');
    mem.map_memory(local_storage_addr, local_storage.ram_size(), local_storage);

    var session_store = new KeyValue.Storage(sessionStorage);
    var session_storage_addr = 0xF0008000;
    var session_storage_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 7);
    var session_storage = new KeyStore(session_store, mem, session_storage_irq, 'SessionStorage');
    mem.map_memory(session_storage_addr, session_storage.ram_size(), session_storage);

    var db_store = new KeyValue.IDB('bacaw', (state) => { console.log('IDBStore', state); });
    var db_storage_addr = 0xF0009000;
    var db_storage_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 8);
    var db_storage = new KeyStore(db_store, mem, db_storage_irq, 'IndexedDB Storage');
    mem.map_memory(db_storage_addr, db_storage.ram_size(), db_storage);

    var ipfs_store = new KeyValue.IPFS(global.IPFS);
    var ipfs_storage_addr = 0xF000A000;
    var ipfs_storage_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 9);
    var ipfs_storage = new KeyStore(ipfs_store, mem, ipfs_storage_irq, 'IPFS Storage');
    mem.map_memory(ipfs_storage_addr, ipfs_storage.ram_size(), ipfs_storage);

    var http_store = new KeyValue.HTTP(global.fetch);
    var http_storage_addr = 0xF000B000;
    var http_storage_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 10);
    var http_storage = new KeyStore(http_store, mem, http_storage_irq, "HTTP Storage");
    mem.map_memory(http_storage_addr, http_storage.ram_size(), http_storage);
  
    var table_store = new KeyValue.Table();
    var table_storage_addr = 0xF000C000;
    var table_storage_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 11);
    var table_storage = new KeyStore(table_store, mem, table_storage_irq, "Table Storage");
    mem.map_memory(table_storage_addr, table_storage.ram_size(), table_storage);

    var sound_addr = 0xF000D000;
    var sound_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 12);
    var sound = new Sound(32, mem, sound_irq, "Sound");
    mem.map_memory(sound_addr, sound.ram_size(), sound);
    
    vm.add_device(mem)
          .add_device(cpu)
      //.add_device(cpu2)
          .add_device(devcon)
          .add_device(keyboard)
          .add_device(video)
          .add_device(timer)
          .add_device(rtc)
          .add_device(local_storage)
        .add_device(session_storage)
        .add_device(db_storage)
        .add_device(http_storage)
        .add_device(ipfs_storage)
          .add_device(table_storage)
          .add_device(sound);

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
    },
    rtc: {
      addr: rtc_addr
    },
    local_storage: {
      addr: local_storage_addr,
      irq: local_storage_irq.toInt()
    },
    session_storage: {
      addr: session_storage_addr,
      irq: session_storage_irq.toInt()
    },
    db_storage: {
      addr: db_storage_addr,
      irq: db_storage_irq.toInt()
    },
    ipfs_storage: {
      addr: ipfs_storage_addr,
      irq: ipfs_storage_irq.toInt()
    },
    http_storage: {
      addr: http_storage_addr,
      irq: http_storage_irq.toInt()
    },
    table_storage: {
      addr: table_storage_addr,
      irq: table_storage_irq.toInt()
    },
      sound: {
          addr: sound_addr,
          irq: sound_irq.toInt()
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
