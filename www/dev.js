const Runner = require('vm/runners/www.js');

const LOAD_OFFSET = 0;

function dev_init()
{
    var vm = Runner.init(640, 480, LOAD_OFFSET);
    var running = false;
    var run = document.getElementById('run-button');
    run.onclick = function() {
        if(vm.cpu.running) {
            running = false;
            run.value = 'Run';
            vm.stop();
        } else {
            running = true;
            run.value = 'Stop';
            vm.run();
        }
    };
    var step = document.getElementById('step-button');
    step.onclick = function() {
        if(!vm.cpu.running && !vm.cpu.check_condition(VM.CPU.STATUS.SLEEP)) {
            vm.step();
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
