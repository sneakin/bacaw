require('vm');
const asm_isr = require('vm/asm/isr');

function input_asm(asm, input_dev_irq, input_dev_addr)
{
  var input_dev_length = 0;
  var input_dev_buffer = 8;

  asm.label('on_input').
      push(VM.CPU.REGISTERS.R0).
      push(VM.CPU.REGISTERS.R1).
      // if waiting for input, wake up
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('waiting_for_input').
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
      cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('on_input_not_waiting', true).
      // wakeup
      cls(VM.CPU.STATUS.SLEEP).
      label('on_input_not_waiting').
      pop(VM.CPU.REGISTERS.R1).
      pop(VM.CPU.REGISTERS.R0).
      rti();

  asm.label('input_flush').
      load(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.INS).uint32(0).
      store(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.INS).uint32(input_dev_addr + input_dev_length).
      ret();
  
  asm.label('reset_input').
      call(0, VM.CPU.REGISTERS.CS).uint32('input_flush').
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('input_data_position').
      ret();

  asm.label('wait_for_input').
      // if input device position == data position: set wait for input and sleep, then reset the data position
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.STATUS).uint32(input_dev_addr + input_dev_length).
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.DS).uint32('input_data_position').
      cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.NEGATIVE).uint32('wait_for_input_sleep', true).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('wait_for_input_sleep', true).
      // or no input
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
      cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('wait_for_input_sleep', true).
      // there's input
      ret();

  asm.label('wait_for_input_sleep').
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(1).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('waiting_for_input').
      call(0, VM.CPU.REGISTERS.CS).uint32('reset_input').
      sleep().
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('waiting_for_input').
      ret();
  
  asm.label('read_byte').
      call(0, VM.CPU.REGISTERS.CS).uint32('wait_for_input').
      // load the byte, inc position, and return
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(input_dev_addr + input_dev_buffer).
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.DS).uint32('input_data_position').
      cls(VM.CPU.STATUS.NUMERICS).
      addi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.STATUS).
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R0).uint32(0).
      // AND out the byte
      load(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.INS).uint32(0xFF).
      and(VM.CPU.REGISTERS.R2).
      // inc position
      inc(VM.CPU.REGISTERS.R1, 0).uint32(1).
      store(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.DS).uint32('input_data_position').
      ret();

  asm.label('input_init');
  // install isr
  asm_isr.isr(asm, input_dev_irq, 'on_input');
  asm.
      // reset variables
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('waiting_for_input').
      call(0, VM.CPU.REGISTERS.CS).uint32('reset_input').
      ret();

}

if(typeof(module) != 'undefined') {
  module.exports = input_asm;
}
