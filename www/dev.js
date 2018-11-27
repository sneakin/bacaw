const Runner = require('vm/runners/www.js');

const RegisterTable = require('dev/register_table');
const CPUInfo = require('dev/cpu_info');
const StackDisplay = require('dev/stack_display');
const MemoryDisplay = require('dev/memory_display');
const InstructionDisplay = require('dev/instruction_display');
const DeviceList = require('dev/device_list');
const DevConDisplay = require('dev/dev_con_display');

const ValueArray = require('value_array');

const LOAD_OFFSET = 0;

function dev_init()
{
    var running = false;
    var run = document.getElementById('run-button');

    // create the VM
    var vm = Runner.init(640, 480, LOAD_OFFSET, null, {
        run: function(vm) {
            running = false;
            run.value = 'Stop';
        },
        stopped: function(vm) {
            running = true;
            run.value = 'Run';
        },
        step: function(vm) {
        }
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
        
        update_timer = requestAnimationFrame(updater);
    }

    updater();

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
        if(vm.running) {
            vm.stop();
        } else {
            vm.step();
            vm.debug_dump();
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
}

if(typeof(window) != 'undefined') {
	window.dev_init = dev_init;
}
