require('vm');
const util = require('more_util');
const Assembler = require('assembler.js');
const asm_input = require('vm/asm/input-device.js');
const asm_output = require('vm/asm/output-device.js');
const asm_isr = require('vm/asm/isr.js');

function BootLoader()
{
}

BootLoader.assembler = function(ds, cs, vm)
{
  var asm = new Assembler();

  asm_isr(asm, VM.CPU.INTERRUPTS.user * 2);
  asm_input(asm, vm.input.irq, vm.input.addr);
  asm_output(asm, vm.output.irq, vm.output.addr);

  asm.label('waiting_for_input', ds).
      label('input_data_position', ds + 4).
      label('waiting_for_output', ds + 8).
      label('output_data_position', ds + 12);

  asm.label('isr_reset').
      load(VM.CPU.REGISTERS.CS, 0, VM.CPU.REGISTERS.INS).uint32(cs).
      load(VM.CPU.REGISTERS.DS, 0, VM.CPU.REGISTERS.INS).uint32(ds).
      call(0, VM.CPU.REGISTERS.CS).uint32('output_init').
      call(0, VM.CPU.REGISTERS.CS).uint32('input_init').
      sie().
      label('read-loop').
      call(0, VM.CPU.REGISTERS.CS).uint32('read_byte').
      push(VM.CPU.REGISTERS.R0).
      call(0, VM.CPU.REGISTERS.CS).uint32('output_write_byte').
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('read-loop');
  
  return asm;
};

BootLoader.assemble = function(ds, cs, vm)
{
  return BootLoader.assembler(ds, cs, vm).assemble();
};

if(typeof(module) != 'undefined') {
  module.exports = BootLoader;
}
if(typeof(window) != 'undefined') {
  window.BootLoader = BootLoader;
}
