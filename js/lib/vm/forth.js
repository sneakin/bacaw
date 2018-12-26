// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 2 -*-

require('vm.js');
const util = require('more_util');
const Assembler = require('assembler.js');
const asm_memcpy = require('vm/asm/memcpy');

var TESTING = 0;

function Forth()
{
}

function asm_isr(asm, max)
{
  max = max || (VM.CPU.INTERRUPTS.max - 1);
  
  asm.load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('isr_reset').bytes([0,0]).
      times(max, function(a, n) {
        a.rti().nop().nop();
      });
  return asm;
}

Forth.assembler = function(ds, cs, info) {
  var asm = new Assembler();

  info = util.merge_options({
    input: {
      irq: 0xA,
      addr: 0xFFFF1000
    },
    output: {
      irq: 0xB,
      addr: 0xFFFF2000
    }
  }, info);
  
  var input_dev_irq = info.input.irq;
  var input_dev_addr = info.input.addr;
  var input_dev_length = 0;
  var input_dev_buffer = 8;

  var output_dev_irq = info.output.irq;
  var output_dev_addr = info.output.addr;
  var output_dev_length = 8 + 1024;
  var output_dev_buffer = 8;

  var dict_entry_size = 8;

  var STACK_SIZE = 4*1024;
  var DS_SIZE = 1024*2;
  var HEAP_REG = VM.CPU.REGISTERS.DS - 1;
  var EVAL_IP_REG = HEAP_REG - 1;
  var STATE_REG = HEAP_REG - 2;
  var PARAM_REG = HEAP_REG - 3;
  var TOS_REG = HEAP_REG - 4;

  function longify(str)
  {
    return str.split('').
        map((c) => c.charCodeAt(0)).
        reverse().
        reduce((a, c) => (a << 8) | c);
  }
  
  var TERMINATOR = longify("STOP");
  var HELO = longify("HELO");
  var OK1 = longify("\r\nOK");
  var OK2 = longify("\r\n> ");
  var ERR1 = longify("\r\nER");
  var ERR2 = longify("\r\n> ");
  
  asm_isr(asm, VM.CPU.INTERRUPTS.user * 2);
  asm_memcpy(asm);

  asm.label('isr_reset').
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(PARAM_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(VM.CPU.REGISTERS.DS, 0, VM.CPU.REGISTERS.INS).uint32(ds).
      load(VM.CPU.REGISTERS.CS, 0, VM.CPU.REGISTERS.INS).uint32(cs).
      call(0, VM.CPU.REGISTERS.CS).uint32('data_init').
      call(0, VM.CPU.REGISTERS.CS).uint32('dict_init').
      call(0, VM.CPU.REGISTERS.CS).uint32('output_init').
      call(0, VM.CPU.REGISTERS.CS).uint32('input_init').
      sie().
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(PARAM_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      call(0, VM.CPU.REGISTERS.CS).uint32('eval-mode').
      call(0, VM.CPU.REGISTERS.CS).uint32('eval-bootstrap').
      //call(0, VM.CPU.REGISTERS.CS).uint32('forth_loop_start').
      call(0, VM.CPU.REGISTERS.CS).uint32('dumb_forth_loop_start').
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('reset');

  asm.label('eval-bootstrap').
      mov(TOS_REG, VM.CPU.REGISTERS.CS).
      inc(TOS_REG).uint32('bootstrap').
      call(0, VM.CPU.REGISTERS.CS).uint32('eval_bytes').
      ret();
  asm.label('bootstrap').
      bytes("[secrets][\n\r!!yeH]^^.......\x00").
      uint32(TERMINATOR);
  
  asm.label('input_data_position', 0).
      label('output_data_position', 4).
      label('waiting_for_input', 8).
      label('waiting_for_output', 12).
      label('heap_top', 16).
      label('eval-word-size', 20).
      label('dict', 24).
      label('dict_end', 24 + 256 * dict_entry_size);

  asm.label('data_init').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(PARAM_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      mov(HEAP_REG, VM.CPU.REGISTERS.DS).
      inc(HEAP_REG).uint32(DS_SIZE).
      store(HEAP_REG, 0, VM.CPU.REGISTERS.DS).uint32('heap_top').
      ret();
  
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
      sie().
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

  //
  // Output
  //

  asm.label('on_output').
      push(VM.CPU.REGISTERS.R0).
      push(VM.CPU.REGISTERS.R1).
      // if waiting for output, wake up
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('waiting_for_output').
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
      cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('on_output_not_waiting', true).
      // wakeup
      cls(VM.CPU.STATUS.SLEEP).
      label('on_output_not_waiting').
      pop(VM.CPU.REGISTERS.R1).
      pop(VM.CPU.REGISTERS.R0).
      rti();

  asm.label('reset_output').
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('output_data_position').
      ret();

  asm.label('wait_for_output').
      // if output device position > 0: set wait for input and sleep, then reset the data position
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.STATUS).uint32(output_dev_addr + output_dev_length).
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
      cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('skip_output_sleep', true).
      label('wait_for_output_sleep').
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(1).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('waiting_for_output').
      sie().
      sleep().
      call(0, VM.CPU.REGISTERS.CS).uint32('reset_output').
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('waiting_for_output').
      label('skip_output_sleep').
      ret();
  
  asm.label('output_flush').
      // R0: amount
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(output_dev_addr + output_dev_length).
      ret();

  asm.label('output_write_byte').
      // R0 byte
      push(VM.CPU.REGISTERS.R0).
      call(0, VM.CPU.REGISTERS.CS).uint32('wait_for_output').
      pop(VM.CPU.REGISTERS.R0).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(output_dev_addr + output_dev_buffer).
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(1).
      call(0, VM.CPU.REGISTERS.CS).uint32('output_flush').
      ret();
  
  asm.label('output_write_word').
      // R0 byte
      push(VM.CPU.REGISTERS.R0).
      call(0, VM.CPU.REGISTERS.CS).uint32('wait_for_output').
      pop(VM.CPU.REGISTERS.R0).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(output_dev_addr + output_dev_buffer).
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(4).
      call(0, VM.CPU.REGISTERS.CS).uint32('output_flush').
      ret();
  
  var isr_asm = new Assembler();
  isr_asm.load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32(asm.resolve('on_input')).bytes([0, 0]);
  var isr_bytes = isr_asm.assemble();
  var isr = new Uint32Array(isr_bytes.buffer, isr_bytes.byteOffset);

  asm.label('input_init').
      // install isr
      push(VM.CPU.REGISTERS.STATUS).
      cie().
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(isr[0]).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(input_dev_irq * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE).
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(isr[1]).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(input_dev_irq * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE + VM.CPU.REGISTER_SIZE).
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('waiting_for_input').
      call(0, VM.CPU.REGISTERS.CS).uint32('reset_input').
      pop(VM.CPU.REGISTERS.STATUS).
      ret();

  isr_asm = new Assembler();
  isr_asm.load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32(asm.resolve('on_output')).bytes([0, 0]);
  isr_bytes = isr_asm.assemble();
  isr = new Uint32Array(isr_bytes.buffer, isr_bytes.byteOffset);

  asm.label('output_init').
      // install isr
      push(VM.CPU.REGISTERS.STATUS).
      cie().
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(isr[0]).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(output_dev_irq * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE).
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(isr[1]).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(output_dev_irq * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE + VM.CPU.REGISTER_SIZE).
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('waiting_for_output').
      call(0, VM.CPU.REGISTERS.CS).uint32('reset_output').
      pop(VM.CPU.REGISTERS.STATUS).
      ret();

  asm.label('reset').
      int(0).
      ret();
  
  asm.label('peek').
      // TOS: address
      load(TOS_REG, 0, TOS_REG).uint32(0).
      ret();

  asm.label('drop').
      load(TOS_REG, 0, HEAP_REG).uint32(0);
  asm.label('roll').
      //inc(HEAP_REG).uint32(4).
      dec(HEAP_REG).uint32(4).
      ret();

  asm.label('poke').
      // R0: address
      // DS+4: value
      mov(VM.CPU.REGISTERS.R0, TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      store(TOS_REG, 0, VM.CPU.REGISTERS.R0).uint32(0).
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      ret();

  asm.label('dup').
      inc(HEAP_REG).uint32(4).
      store(TOS_REG, 0, HEAP_REG).uint32(0).
      ret();

  asm.label('dup1').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, HEAP_REG).int32(4 * -1).
      ret();

  asm.label('dup2').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, HEAP_REG).uint32(4 * -2).
      ret();

  asm.label('swap').
      load(VM.CPU.REGISTERS.R1, 0, HEAP_REG).uint32(0).
      store(TOS_REG, 0, HEAP_REG).uint32(0).
      mov(TOS_REG, VM.CPU.REGISTERS.R1).
      ret();

  asm.label('write').
      mov(VM.CPU.REGISTERS.R0, TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('output_write_byte').
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      ret();

  asm.label('write_word').
      mov(VM.CPU.REGISTERS.R0, TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('output_write_word').
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      ret();

  // fixme input can't be read when the input device's buffer is used
  // for the evaluation buffer
  
  asm.label('read').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      call(0, VM.CPU.REGISTERS.CS).uint32('read_byte').
      mov(TOS_REG, VM.CPU.REGISTERS.R0).
      ret();
  
  asm.label('selfie').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      mov(TOS_REG, PARAM_REG).
      ret();

  asm.label('zero').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      ret();

  asm.label('ifthen').
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
      cmpi(TOS_REG, VM.CPU.REGISTERS.R1).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('ifthen_else', true).
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      call(0, VM.CPU.REGISTERS.CS).uint32('execute').
      inc(VM.CPU.REGISTERS.IP).uint32('ifthen_end', true).
      label('ifthen_else').
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      call(0, VM.CPU.REGISTERS.CS).uint32('execute').
      label('ifthen_end').
      ret();

  asm.label('equal').
      mov(VM.CPU.REGISTERS.R0, TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      cmpi(VM.CPU.REGISTERS.R0, TOS_REG).
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(TOS_REG, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32(1).
      ret();

  asm.label('read_string').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(TERMINATOR).
      call(0, VM.CPU.REGISTERS.CS).uint32('swap'). // 0xFFFF, terminator
      label('read_string_loop').
      call(0, VM.CPU.REGISTERS.CS).uint32('read'). // 0xFFFF, terminator, new byte
      call(0, VM.CPU.REGISTERS.CS).uint32('swap'). // 0xFFFF, new byte, terminator
      call(0, VM.CPU.REGISTERS.CS).uint32('dup'). // 0xFFFF, new byte, terminator, term
      call(0, VM.CPU.REGISTERS.CS).uint32('dup2').  // 0xFFFF, new byte, terminator, term, new byte
      call(0, VM.CPU.REGISTERS.CS).uint32('equal'). // 0xFFFF, new byte, terminator, equality
      call(0, VM.CPU.REGISTERS.CS).uint32('dup'). // next load erases R0
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0xFE). // loop
      call(0, VM.CPU.REGISTERS.CS).uint32('swap'). // 0xFFFF, new byte, terminator, then, equality
      call(0, VM.CPU.REGISTERS.CS).uint32('dup'). // next load erases R0
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0xFD). // done
      call(0, VM.CPU.REGISTERS.CS).uint32('swap'). // 0xFFFF, new byte, terminator, then, else, equality
      call(0, VM.CPU.REGISTERS.CS).uint32('ifthen').
      ret();

  asm.label('read_string_done').
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      call(0, VM.CPU.REGISTERS.CS).uint32('here').
      ret();

  // read_string but uses the terminator in the definition's parameter
  asm.label('read_string_reg_term').
      //push(PARAM_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('here').
      label('read_string_reg_term_loop').
      push(PARAM_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('read'). // here, new byte
      call(0, VM.CPU.REGISTERS.CS).uint32('dup'). // here, new byte, new byte
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.SP).uint32(0).
      //load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(TERMINATOR). // here, byte, byte, term
      call(0, VM.CPU.REGISTERS.CS).uint32('equal'). // here, byte, equality
      call(0, VM.CPU.REGISTERS.CS).uint32('dup'). // next load erases TOS
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0xFE). // done
      call(0, VM.CPU.REGISTERS.CS).uint32('swap'). // here, new byte, then, equality
      call(0, VM.CPU.REGISTERS.CS).uint32('dup'). // next load erases TOS
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0xFD). // loop
      call(0, VM.CPU.REGISTERS.CS).uint32('swap'). // here, new byte, then, else, equality
      call(0, VM.CPU.REGISTERS.CS).uint32('ifthen').
      pop(PARAM_REG).
      ret();

  asm.label('read_string_reg_term_preloop').
      // here, new byte
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      // new byte, here
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('read_string_reg_term_loop').
      ret();
  
  asm.label('read_string_reg_term_done').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(TERMINATOR). // bytes, here, term
      call(0, VM.CPU.REGISTERS.CS).uint32('swap'). // bytes, term, here
      ret();

  asm.label('eip').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      mov(TOS_REG, EVAL_IP_REG).
      ret();

  asm.label('here').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      mov(TOS_REG, HEAP_REG).
      inc(TOS_REG).uint32(4).
      ret();

  asm.label('forget').
      mov(HEAP_REG, TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      ret();

  asm.label('conpush').
      pop(VM.CPU.REGISTERS.R0).
      push(TOS_REG).
      push(VM.CPU.REGISTERS.R0).
      ret();

  asm.label('conpop').
      pop(VM.CPU.REGISTERS.R0).
      pop(TOS_REG).
      push(VM.CPU.REGISTERS.R0).
      ret();
  
  asm.label('stash').
      mov(PARAM_REG, TOS_REG).
      ret();

  asm.label('param').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      mov(TOS_REG, PARAM_REG).
      ret();

  asm.label('nopper').
      ret();

  asm.label('bitshift-left').
      // R0: value
      // D+0: amount
      mov(VM.CPU.REGISTERS.R0, TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      cls(VM.CPU.STATUS.NUMERICS).
      bsl(TOS_REG, VM.CPU.REGISTERS.STATUS).
      mov(VM.CPU.REGISTERS.R0, TOS_REG).
      ret();

  asm.label('literal-byte').
      load(VM.CPU.REGISTERS.R0, 0, EVAL_IP_REG).uint32(0).
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0xFF).
      and(VM.CPU.REGISTERS.R1).
      push(VM.CPU.REGISTERS.R0).
      call(0, VM.CPU.REGISTERS.CS).uint32('eval-inc-ip').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      pop(TOS_REG).
      ret();

  asm.label('literal-long').
      load(VM.CPU.REGISTERS.R0, 0, EVAL_IP_REG).uint32(0).
      and(PARAM_REG).
      push(VM.CPU.REGISTERS.R0).
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(4).
      call(0, VM.CPU.REGISTERS.CS).uint32('eval-inc-ip-by').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      pop(TOS_REG).
      ret();
  
  /*
  asm.label('literal_shift').
      load(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.INS).uint32(8).
      cls(VM.CPU.STATUS.NUMERICS).
      bsl(VM.CPU.REGISTERS.R2, VM.CPU.REGISTERS.STATUS).
      mov(PARAM_REG, TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      cls(VM.CPU.STATUS.NUMERICS).
      addi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.STATUS).
      ret();
*/
  
  asm.label('literal_shift').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32('literal_shift_def').
      call(0, VM.CPU.REGISTERS.CS).uint32('eval_bytes').
      ret().
      label('literal_shift_def').
      bytes("'\x08%L+\x00"); /* lit 8 swap bsl-left + */
  /*
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(8).
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      call(0, VM.CPU.REGISTERS.CS).uint32('bitshift-left').
      call(0, VM.CPU.REGISTERS.CS).uint32('add').
*/
      
  asm.label('literal-script-long').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32('literal-script-long_def').
      call(0, VM.CPU.REGISTERS.CS).uint32('eval_bytes').
      ret().
      label('literal-script-long_def').
      bytes("\xA3\xA3\xA3\x00"); /* lit-shift lit-shift lit-shift */

  /*
  asm.label('literal').
      call(0, VM.CPU.REGISTERS.CS).uint32('read').
      call(0, VM.CPU.REGISTERS.CS).uint32('read').
      call(0, VM.CPU.REGISTERS.CS).uint32('read').
      call(0, VM.CPU.REGISTERS.CS).uint32('read').
      call(0, VM.CPU.REGISTERS.CS).uint32('literal_shift').
      call(0, VM.CPU.REGISTERS.CS).uint32('literal_shift').
      call(0, VM.CPU.REGISTERS.CS).uint32('literal_shift').
      ret();
  */
  
  var Dictionary = {
    '\x03': [ 'isr_reset', 0 ],
    '\x06': [ 'forth_loop_start', 0 ],
    '\x04': [ 'input_flush', 0 ],
    '\x07': [ 'dumb_forth_loop_start', 0 ],
    '@': [ 'here', 0 ],
    'F': [ 'forget', 0 ],
    '(': [ 'eip', 0 ],
    ')': [ 'eval_words', 0 ],
    'J': [ 'call', 0 ],
    '>': [ 'peek', 0 ],
    '<': [ 'poke', 0 ],
    '^': [ 'drop', 0 ],
    '~': [ 'dup', 0 ],
    '%': [ 'swap', 0 ],
    '?': [ 'ifthen', 0 ],
    'U': [ 'conpush', 0 ],
    'D': [ 'conpop', 0 ],
    ':': [ 'define-sym', 0 ],
    'S': [ 'set-sym-value', 0 ],
    '$': [ 'lookup-addr', 0 ],
    '0': [ 'zero', 0 ],
    '=': [ 'equal', 0 ],
    '.': [ 'write', 0 ],
    //',': [ 'write_word', 0 ],
    '\'': [ 'literal-byte', 0 ],
    '|': [ 'read', 0 ],
    'I': [ 'input_flush', 0 ],
    '\"': [ 'read_string_reg_term', '\"'.charCodeAt(0) ],
    '\xFD': [ 'read_string_reg_term_preloop', '\"'.charCodeAt(0) ],
    '\xFE': [ 'read_string_reg_term_done', 0 ],
    '#': [ 'literal-script-long', 0 ],
    '\xA3': [ 'literal_shift', 0 ],
    'L': [ 'bitshift-left', 0 ],
    '+': [ 'int-add', 0 ],
    '-': [ 'int-sub', 0 ],
    '*': [ 'int-mul', 0 ],
    '/': [ 'int-div', 0 ],
    '/': [ 'stash', 0 ],
    '\\': [ 'param', 0 ],
    '\n': [ 'nopper', 0 ],
    '\r': [ 'nopper', 0 ],
    '_': [ 'execute', 0 ],
    '[': [ 'literal-mode', ']'.charCodeAt(0) ],
    '{': [ 'compile-mode', '}'.charCodeAt(0) ]
  };

  asm.label('dict_init').
      // R1: ptr to dict
      // R2: counter
      mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.DS).
      inc(VM.CPU.REGISTERS.R0).uint32('dict').
      push(VM.CPU.REGISTERS.R0).
      mov(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.R0).
      load(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.INS).uint32(0).
      label('dict_init_loop').
      load(VM.CPU.REGISTERS.R3, 0, VM.CPU.REGISTERS.INS).uint32(256).
      cmpi(VM.CPU.REGISTERS.R2, VM.CPU.REGISTERS.R3).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('dict_init_loop_done', true).
      // loop body
      // copy ops
      load(VM.CPU.REGISTERS.R3, 0, VM.CPU.REGISTERS.INS).uint32('selfie').
      store(VM.CPU.REGISTERS.R3, 0, VM.CPU.REGISTERS.R1).uint32(0).
      store(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.R1).uint32(4).
      // inc counters
      inc(VM.CPU.REGISTERS.R2).uint32(1).
      inc(VM.CPU.REGISTERS.R1).uint32(dict_entry_size).
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('dict_init_loop').
      label('dict_init_loop_done').
      // setup explicit entries
      pop(VM.CPU.REGISTERS.R1);

  for(var op in Dictionary) {
    var sym = Dictionary[op][0];
    var param = Dictionary[op][1];
    var op = op.charCodeAt(0);
    asm.load(VM.CPU.REGISTERS.R3, 0, VM.CPU.REGISTERS.INS).uint32(sym).
        store(VM.CPU.REGISTERS.R3, 0, VM.CPU.REGISTERS.R1).uint32(op * dict_entry_size).
        load(VM.CPU.REGISTERS.R3, 0, VM.CPU.REGISTERS.INS).uint32(param).
        store(VM.CPU.REGISTERS.R3, 0, VM.CPU.REGISTERS.R1).uint32(4 + op * dict_entry_size);
  }

  asm.ret();

  // lookup
  asm.label('lookup-addr').
      // TOS: symbol
      mov(VM.CPU.REGISTERS.R1, TOS_REG).
      // R1: symbol
      // R2: dictionary address
      load(VM.CPU.REGISTERS.R2, 0, STATE_REG).uint32(4).
      // R0: entry offset
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(dict_entry_size).
      cls(VM.CPU.STATUS.NUMERICS).
      muli(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.STATUS).
      cls(VM.CPU.STATUS.NUMERICS).
      addi(VM.CPU.REGISTERS.R2, VM.CPU.REGISTERS.STATUS).
      // TOS: entry address
      mov(TOS_REG, VM.CPU.REGISTERS.R0).
      ret();

  asm.label('lookup-sym').
      call(0, VM.CPU.REGISTERS.CS).uint32('lookup-addr');
  asm.label('load-entry').
      // load entry value and param
      load(PARAM_REG, 0, TOS_REG).uint32(4).
      load(TOS_REG, 0, TOS_REG).uint32(0).
      ret();
  
  // define
  asm.label('set-sym-value').
      // value, sym
      call(0, VM.CPU.REGISTERS.CS).uint32('lookup-addr').
      // value, entry
      call(0, VM.CPU.REGISTERS.CS).uint32('poke').
      ret();

  asm.label('set-sym-param').
      // value, sym
      call(0, VM.CPU.REGISTERS.CS).uint32('lookup-addr').
      inc(TOS_REG).uint32(4).
      // value, entry+4
      call(0, VM.CPU.REGISTERS.CS).uint32('poke').
      ret();

  asm.label('set-sym-eval').
      // sym
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32('eval_param').
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      call(0, VM.CPU.REGISTERS.CS).uint32('set-sym-value').
      ret();
  
  asm.label('define-sym').
      // (ptr sym)
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      call(0, VM.CPU.REGISTERS.CS).uint32('set-sym-eval').
      call(0, VM.CPU.REGISTERS.CS).uint32('set-sym-param').
      ret();
  
  asm.label('execute').
      // TOS: sym
      // Data: call args
      call(0, VM.CPU.REGISTERS.CS).uint32('lookup-addr');
  asm.label('execute-addr').
      call(0, VM.CPU.REGISTERS.CS).uint32('load-entry');
  asm.label('call').
      mov(VM.CPU.REGISTERS.R0, TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      callr(VM.CPU.REGISTERS.CS, VM.CPU.REGISTERS.R0).
      ret();

  //
  // Eval mode
  // Evaluates each token as it is encountered.
  //
  
  asm.label('eval-mode').
      //load(STATE_REG, 0, VM.CPU.REGISTERS.INS).uint32('eval-state').
      mov(STATE_REG, VM.CPU.REGISTERS.CS).
      inc(STATE_REG).uint32('eval-state').
      // set exec field
      //mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.CS).
      //inc(VM.CPU.REGISTERS.R0).uint32('execute').
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32('execute').
      store(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(0).
      // set param field
      mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.DS).
      inc(VM.CPU.REGISTERS.R0).uint32('dict').
      store(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(4).
      ret();

  asm.label('eval-state').
      uint32('execute'). // placeholders as offsets added later
      uint32('dict').
      uint32(0xFF);

  //
  // Exec mode
  // Evaluates a list of dictionary addresses.
  //
  
  asm.label('exec-execute').
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('execute-addr');

  asm.label('exec-mode').
      //load(STATE_REG, 0, VM.CPU.REGISTERS.INS).uint32('exec-state').
      mov(STATE_REG, VM.CPU.REGISTERS.CS).
      inc(STATE_REG).uint32('exec-state').
      // load state fields
      //mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.CS).
      //inc(VM.CPU.REGISTERS.R0).uint32('execute-addr').
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32('exec-execute').
      store(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(0).
      mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.DS).
      inc(VM.CPU.REGISTERS.R0).uint32('dict').
      store(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(4).
      ret();

  asm.label('exec-state').
      uint32('execute-addr').
      uint32('dict').
      uint32(0xFFFFFFFF);

  //
  // Indirect mode
  // Replaces the tokens with their dictionary entry addresses.
  //
  
  asm.label('lookup-indirect').
      load(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(12).
      cmpi(TOS_REG, VM.CPU.REGISTERS.R0).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('indirect-done', true).
      call(0, VM.CPU.REGISTERS.CS).uint32('lookup-addr').
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      ret();
  asm.label('indirect-done').
      // terminate string
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(TERMINATOR).
      // swap pointer and terminator
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      // save stack position from before {
      push(TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      // eval data
      call(0, VM.CPU.REGISTERS.CS).uint32('exec-mode').
      call(0, VM.CPU.REGISTERS.CS).uint32('input_flush').
      call(0, VM.CPU.REGISTERS.CS).uint32('eval_words').
      // move stack back fixme?
      pop(HEAP_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('roll').
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      call(0, VM.CPU.REGISTERS.CS).uint32('eval-mode').
      ret();
  asm.label('indirect-mode'). // literal mode followed by eval
      call(0, VM.CPU.REGISTERS.CS).uint32('here').
      //load(STATE_REG, 0, VM.CPU.REGISTERS.INS).uint32('indirect-state').
      mov(STATE_REG, VM.CPU.REGISTERS.CS).
      inc(STATE_REG).uint32('indirect-state').
      // set state fields
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32('lookup-indirect').
      store(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(0).
      mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.DS).
      inc(VM.CPU.REGISTERS.R0).uint32('dict').
      store(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(4).
      store(PARAM_REG, 0, STATE_REG).uint32(12).
      ret();

  asm.label('indirect-state').
      uint32('lookup-indirect').
      uint32('dict').
      uint32(0xFF).
      uint32(PARAM_REG);

  //
  // Literal mode
  // Pushes tokens straight to the data stack.
  //
  
  asm.label('lookup-literal-mode').
      load(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(4).
      cmpi(TOS_REG, VM.CPU.REGISTERS.R0).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('literal-mode-done', true).
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      ret();
  asm.label('literal-mode-done').
      //mov(TOS_REG, VM.CPU.REGISTERS.R2).
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(TERMINATOR).
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      call(0, VM.CPU.REGISTERS.CS).uint32('eval-mode').
      ret();
  asm.label('literal-mode').
      call(0, VM.CPU.REGISTERS.CS).uint32('here'). 
      mov(STATE_REG, VM.CPU.REGISTERS.CS).
      inc(STATE_REG).uint32('literal-state').
      // set state fields
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32('lookup-literal-mode').
      store(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(0).
      store(PARAM_REG, 0, STATE_REG).uint32(4).
      ret();

  asm.label('literal-state').
      uint32('lookup-literal-mode').
      uint32(PARAM_REG).
      uint32(0xFF);
  
  //
  // Compile mode
  // Replaces the tokens with their machine code calls and loads.
  //

  var op_asm = new Assembler();
  op_asm.nop().call(0, VM.CPU.REGISTERS.CS);
  var NOPCALL = op_asm.assemble();

  asm.label('emit-call').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).bytes(NOPCALL).
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      ret();

  op_asm = new Assembler();
  op_asm.nop().load(TOS_REG, 0, VM.CPU.REGISTERS.INS);
  var NOPLOAD = op_asm.assemble();

  asm.label('emit-literal').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).bytes(NOPLOAD).
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      ret();

  op_asm = new Assembler();
  op_asm.nop().load(PARAM_REG, 0, VM.CPU.REGISTERS.INS);
  var NOPLOAD_PARAM = op_asm.assemble();

  asm.label('emit-param').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).bytes(NOPLOAD_PARAM).
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      ret();

  op_asm = new Assembler();
  op_asm.ret().nop();
  var RETNOP = op_asm.assemble();

  asm.label('emit-ret').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).bytes(RETNOP).
      ret();
  
  asm.label('lookup-compile').
      load(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(12).
      cmpi(TOS_REG, VM.CPU.REGISTERS.R0).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('compile-done', true).
       // save here ptr
      call(0, VM.CPU.REGISTERS.CS).uint32('swap').
      push(TOS_REG).
      // lookup sym
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      call(0, VM.CPU.REGISTERS.CS).uint32('lookup-sym').
      // emit machine codes
      push(TOS_REG).
      mov(TOS_REG, PARAM_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('emit-param').
      pop(TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('emit-call').
      // pop here ptr
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      pop(TOS_REG).
      ret();
  asm.label('compile-done').
      // save pointer
      call(0, VM.CPU.REGISTERS.CS).uint32('drop').
      push(TOS_REG).
      // terminate string
      call(0, VM.CPU.REGISTERS.CS).uint32('emit-ret').
      // restore pointer
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      pop(TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('eval-mode').
      ret();
  asm.label('compile-mode'). // literal mode followed by eval
      call(0, VM.CPU.REGISTERS.CS).uint32('here').
      mov(STATE_REG, VM.CPU.REGISTERS.CS).
      inc(STATE_REG).uint32('compile-state').
      // set state fields
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32('lookup-compile').
      store(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(0).
      mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.DS).
      inc(VM.CPU.REGISTERS.R0).uint32('dict').
      store(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(4).
      store(PARAM_REG, 0, STATE_REG).uint32(12).
      ret();

  asm.label('compile-state').
      uint32('lookup-compile').
      uint32('dict').
      uint32(0xFF).
      uint32(PARAM_REG);

  var math_ops = {
    addi: 'int-add',
    subi: 'int-sub',
    muli: 'int-mul',
    divi: 'int-div'
  };
  
  for(var k in math_ops) {
    asm.label(math_ops[k]).
        mov(VM.CPU.REGISTERS.R0, TOS_REG).
        call(0, VM.CPU.REGISTERS.CS).uint32('drop').
        cls(VM.CPU.STATUS.NUMERICS);

    asm[k](TOS_REG, VM.CPU.REGISTERS.STATUS);

    asm.mov(TOS_REG, VM.CPU.REGISTERS.R0).
        ret();
  }

  asm.label('eval_param').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      mov(TOS_REG, PARAM_REG);
  asm.label('eval_words').
      load(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.DS).uint32('eval-word-size').
      push(VM.CPU.REGISTERS.R2).
      load(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.INS).uint32(4).
      store(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.DS).uint32('eval-word-size').
      call(0, VM.CPU.REGISTERS.CS).uint32('eval').
      pop(VM.CPU.REGISTERS.R2).
      store(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.DS).uint32('eval-word-size').
      ret();
  
  asm.label('eval_bytes').
      // TOS: ptr
      load(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.DS).uint32('eval-word-size').
      push(VM.CPU.REGISTERS.R2).
      load(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.INS).uint32(1).
      store(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.DS).uint32('eval-word-size').
      call(0, VM.CPU.REGISTERS.CS).uint32('eval').
      pop(VM.CPU.REGISTERS.R2).
      store(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.DS).uint32('eval-word-size').
      ret();

  asm.label('eval-inc-ip-by').
      // TOS amount
      mov(VM.CPU.REGISTERS.R0, TOS_REG).
      cls(VM.CPU.STATUS.NUMERICS).
      addi(EVAL_IP_REG, VM.CPU.REGISTERS.STATUS).
      mov(EVAL_IP_REG, VM.CPU.REGISTERS.R0).
      ret();

  asm.label('eval-inc-ip').
      push(TOS_REG).
      load(TOS_REG, 0, VM.CPU.REGISTERS.DS).uint32('eval-word-size').
      call(0, VM.CPU.REGISTERS.CS).uint32('eval-inc-ip-by').
      pop(TOS_REG).
      ret();

  asm.label('eval').
      // TOS: ptr to string to eval
      push(EVAL_IP_REG).
      mov(EVAL_IP_REG, TOS_REG).
      call(0, VM.CPU.REGISTERS.CS).uint32('drop');
  
  asm.label('eval-next').
      // EVAL_IP_REG has next address
      // lookup: load byte
      load(VM.CPU.REGISTERS.R0, 0, EVAL_IP_REG).uint32(0).
      // jump to done when the byte == TERMINATOR
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(TERMINATOR).
      cmpi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.R0).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('eval-done', true).
      // AND out the byte
      load(VM.CPU.REGISTERS.R1, 0, STATE_REG).uint32(8).
      and(VM.CPU.REGISTERS.R1).
      // jump to done when the byte == 0
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
      cmpi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.R0).
      inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('eval-done', true).
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      mov(TOS_REG, VM.CPU.REGISTERS.R0).
      // advance eval's IP
      call(0, VM.CPU.REGISTERS.CS).uint32('eval-inc-ip').
      // make call
      load(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(0).
      callr(VM.CPU.REGISTERS.CS, VM.CPU.REGISTERS.R0).
      // prep next loop
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('eval-next');
  asm.label('eval-done').
      pop(EVAL_IP_REG).
      ret();

  asm.label('dumb_forth_loop_start').
      call(0, VM.CPU.REGISTERS.CS).uint32('write_helo').
      call(0, VM.CPU.REGISTERS.CS).uint32('write_ok');
  asm.label('dumb_forth_loop').
      call(0, VM.CPU.REGISTERS.CS).uint32('read').
      load(VM.CPU.REGISTERS.R0, 0, STATE_REG).uint32(0).
      // execute the token
      callr(VM.CPU.REGISTERS.CS, VM.CPU.REGISTERS.R0).
      // loop back
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('dumb_forth_loop').
      ret();

  asm.label('write_helo').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(HELO).
      call(0, VM.CPU.REGISTERS.CS).uint32('write_word').
      ret();

  asm.label('write_ok').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(OK1).
      call(0, VM.CPU.REGISTERS.CS).uint32('write_word').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(OK2).
      call(0, VM.CPU.REGISTERS.CS).uint32('write_word').
      ret();

  asm.label('write_err').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(ERR1).
      call(0, VM.CPU.REGISTERS.CS).uint32('write_word').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(ERR2).
      call(0, VM.CPU.REGISTERS.CS).uint32('write_word').
      ret();

  asm.label('forth_loop_start').
      call(0, VM.CPU.REGISTERS.CS).uint32('write_helo');
  asm.label('forth_loop').
      call(0, VM.CPU.REGISTERS.CS).uint32('dup').
      call(0, VM.CPU.REGISTERS.CS).uint32('write_ok').
      call(0, VM.CPU.REGISTERS.CS).uint32('input_flush').
      call(0, VM.CPU.REGISTERS.CS).uint32('wait_for_input').
      load(TOS_REG, 0, VM.CPU.REGISTERS.STATUS).uint32(input_dev_addr + input_dev_length).
      load(PARAM_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      cmpi(TOS_REG, PARAM_REG).
      load(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32('forth_loop_halt').
      //call(0, VM.CPU.REGISTERS.CS).uint32('dup'). // the length
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(input_dev_addr + input_dev_buffer).
      call(0, VM.CPU.REGISTERS.CS).uint32('eval_bytes').
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('forth_loop').
      ret();

  asm.label('forth_loop_halt').
      call(0, VM.CPU.REGISTERS.CS).uint32('write_err').
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('forth_loop');
      
  asm.label('program-size').
      uint32('program-size');
  
  return asm;
}

Forth.assemble = function(ds, cs, info) {
  return Forth.assembler(ds, cs, info).assemble();
}
  
if(typeof(module) != 'undefined') {
  module.exports = Forth;
}

if(typeof(window) != 'undefined') {
  window.Forth = Forth;
}
