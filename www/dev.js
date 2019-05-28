// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 4 -*-
const Runner = require('vm/runners/www.js');
const BootLoader = require('vm/boot_loader.js');
const RegisterTable = require('dev/register_table');
const CPUInfo = require('dev/cpu_info');
const StackDisplay = require('dev/stack_display');
const MemoryDisplay = require('dev/memory_display');
const InstructionDisplay = require('dev/instruction_display');
const DeviceList = require('dev/device_list');
const DevConDisplay = require('dev/dev_con_display');
const Tabber = require('tabber');
const FS = require('fs');
const Terminal = require('vm/devices/terminal');
const VMWorker = require('vm/service_worker');

const LOAD_OFFSET = 0;

function AssemblyEditor(vm)
{
    var asm_load = document.getElementById('asm-load-button');
    var src = document.getElementById('asm-source');
    src.value = FS.readFileSync(__dirname + '/dev/assembly_editor_source.js', 'utf-8');
    var log = document.getElementById('asm-log');
    
    asm_load.onclick = function() {
        var f = new Function(src.value);
        var asm = new VM.Assembler(vm);
        try {
            f(vm, asm);
        } catch(e) {
            log.innerText = e.stack;
            console.log(e);
        }
    };
}

const STATE_ICONS = {
    stopped: "🥚",
    running: "🐣"
};

function dev_init()
{
    var running = false;
    var run = document.getElementById('run-button');
    var state_icon = document.getElementById('vm-state-icon');
    state_icon.innerText = STATE_ICONS.stopped;

    // create the VM
    var vm = Runner.init(640, 480, LOAD_OFFSET, null, {
        run: function(vm) {
            running = false;
            run.value = 'Stop';
            state_icon.innerText = STATE_ICONS.running;
        },
        stopped: function(vm) {
            running = true;
            run.value = 'Run';
            state_icon.innerText = STATE_ICONS.stopped;
        },
        step: function(vm) {
        }
    });

  var worker = null;
  VMWorker.register('service_worker.js', window.location).then((reg) => {
    worker = reg;
    console.log("ServiceWorker register", reg);
  }).catch((error) => {
    console.log("ServiceWorker failed to register", error);
  });
  
    // Hook the widgets' elements
    var register_table = new RegisterTable(document.getElementById('registers'));
    var stack_display = new StackDisplay(document.getElementById('stack'), 128);
    var cpu_info = new CPUInfo();
    var inst_display = new InstructionDisplay(vm, 16);
    var memory_display = new MemoryDisplay(vm, 1024, 16);
    var devcon = new DevConDisplay(document.getElementById('console'), document.getElementById('console-log'), vm.devcon);
    var device_list = new DeviceList(document.getElementById('devices'), vm);

    // Frame updater
    var update_timer;
    var first_time, last_time;

    function updater(t)
    {
        var dt = t - last_time;
        if(first_time == null) first_time = t;
        last_time = t;

        register_table.update(vm);
        cpu_info.update(vm, dt);
        stack_display.update(vm);
        device_list.update(vm);
        inst_display.update();
        memory_display.update();

        if(!window.stop_timer) {
            update_timer = requestAnimationFrame(updater);
        }
    }
    
    updater();

    Tabber.init({ sets: [
        { initial: 1,
          tabs: document.querySelector('.test-tabs.tabs'),
          pages: document.querySelectorAll('.test-tabs > .tabpage')
        },
        { tabs: document.querySelector('#sidebar-left > .tabs'),
          pages: document.querySelectorAll('#sidebar-left > .tabpage')
        },
        { tabs: document.querySelector('#sidebar-right > .tabs'),
          pages: document.querySelectorAll('#sidebar-right > .tabpage')
        },
        { tabs: document.querySelector('#displays .tabs'),
          pages: document.querySelectorAll('#displays .tabpage')
        },
        { tabs: document.querySelector('#cpu-state > .tabs'),
          pages: document.querySelectorAll('#cpu-state > .tabpage')
        }
    ]});

    // Button logic
    
    run.onclick = function() {
        if(vm.running) {
            vm.stop();
        } else {
            vm.run();
        }
    };
    var step = document.getElementById('step-button');
    step.onclick = function() {
      vm.stop();
      if(vm.cpu) {
        vm.cpu.halted = false;
        vm.cpu.step();
      }
    };
    
    var reset = document.getElementById('reset-button');
    reset.onclick = function() {
        vm.reset();
    };
    
    var reader = new FileReader();
    reader.onload = function(e) {
        var ub = new Uint8Array(e.target.result, e.target.result.byteOffset);
        vm.cpu.memwrite(0, ub);
        console.log("Wrote " + ub.byteLength + " bytes", ub);
    };
    var load = document.getElementById('load-button');
    load.onchange = function(e) {
        var file = e.target.files[0];
        console.log("Reading", file, e.target.files);
        reader.readAsArrayBuffer(file);
    };

    var reload = document.getElementById('reload-button');
    reload.onclick = function() {
        vm.cpu.memwrite(LOAD_OFFSET, program_code);
    };

    var update_page = document.getElementById('update-page-checkbox');
    update_page.onchange = function() {
        window.stop_timer = !update_page.checked;
        if(update_page.checked) {
            updater();
        }
    };

    var asm_editor = new AssemblyEditor(vm);

    var term = new Terminal(document.getElementById('tty'), {
        fontFamily: 'Inconsolata',
        fontSize: 16
    });
  var input_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 4);
  var input_addr = 0xF0004000;
  var input_term = term.get_input_device(1024, input_irq);
  vm.mem.map_memory(input_addr, input_term.ram_size(), input_term);
  vm.add_device(input_term);

  vm.info.input = {
    addr: input_addr,
    irq: input_irq
  };

  var output_irq = vm.interrupt_handle(VM.CPU.INTERRUPTS.user + 3);
  var output_addr = 0xF0003000;
  var output_term = term.get_output_device(1024, output_irq);
  vm.mem.map_memory(output_addr, output_term.ram_size(), output_term);
  vm.add_device(output_term);
  vm.info.output = {
    addr: output_addr,
    irq: output_irq
  };

  var boot_loader = BootLoader.assemble(1024*1024, 0, vm.info);
  vm.cpu.memwrite(0, boot_loader);
}

if(typeof(window) != 'undefined') {
	window.dev_init = dev_init;
}
