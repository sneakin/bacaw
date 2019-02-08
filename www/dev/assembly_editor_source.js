var vm = arguments[0];
var asm = arguments[1];

asm.load(0, 0, 15).uint32(123).
    halt();

vm.stop();
vm.cpu.memwrite(0, asm.assemble());
vm.reset();
