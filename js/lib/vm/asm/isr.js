require('vm');
const Assembler = require('assembler');

function isr(asm, irq, label)
{
  var isr_asm = new Assembler();
  isr_asm.load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32(asm.resolve(label)).bytes([0, 0]);
  var isr_bytes = isr_asm.assemble();
  var isr = new Uint32Array(isr_bytes.buffer, isr_bytes.byteOffset);
  
  asm.push(VM.CPU.REGISTERS.STATUS).
      cie().
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(isr[0]).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(irq * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE).
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(isr[1]).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(irq * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE + VM.CPU.REGISTER_SIZE).
      pop(VM.CPU.REGISTERS.STATUS);
}

function asm_isr(asm, max)
{
  max = max || (VM.CPU.INTERRUPTS.max - 1);
  
  asm.load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('isr_reset').bytes([0,0]).
      times(max, function(a, n) {
        a.rti().nop().nop().nop();
      });
  return asm;
}

if(typeof(module) != 'undefined') {
  module.exports = asm_isr;
  module.exports.isr = isr;
}
