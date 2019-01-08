// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 2 -*-

require('vm/types');
const util = require('more_util');
const Assembler = require('assembler.js');
require('vm');
const asm_memcpy = require('vm/asm/memcpy');
const DataStruct = require('data_struct');

var TESTING = 0;

function Forth()
{
}

function longify(str)
{
  return str.split('').
      map((c) => c.charCodeAt(0)).
      reverse().
      reduce((a, c) => (a << 8) | c);
}

var TERMINATOR = longify("STOP");
var CRNL = longify("\r\n");
var HELO = longify("HELO");
var BYE = longify("\nBYE");
var OK1 = longify(" OK ");
var OK2 = longify("\r\n> ");
var ERR1 = longify("\r\nER");
var ERR2 = longify("\r\n> ");

function cellpad(str)
{
  var arr = new Uint8Array((2 + str.length) * VM.TYPES.ULONG.byte_size);
  var dv = new DataView(arr.buffer);

  VM.TYPES.ULONG.set(dv, 0, str.length, true);
  VM.TYPES.ULONG.set(dv, (1 + str.length) * VM.TYPES.ULONG.byte_size, TERMINATOR, true);
  
  for(var i = 0; i < str.length; i++) {
    VM.TYPES.ULONG.set(dv, (1 + i) * VM.TYPES.ULONG.byte_size, str.charCodeAt(i), true);
  }
  
  return arr;
}

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
        a.rti().nop().nop();
      });
  return asm;
}

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

  asm.label('input_init');
  // install isr
  isr(asm, input_dev_irq, 'on_input');
  asm.
      // reset variables
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('waiting_for_input').
      call(0, VM.CPU.REGISTERS.CS).uint32('reset_input').
      ret();

}

function output_asm(asm, output_dev_irq, output_dev_addr)
{
  //
  // Output
  //

  var output_dev_length = 8 + 1024;
  var output_dev_buffer = 8;

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

  asm.label('output_init');
  isr(asm, output_dev_irq, 'on_output');
  asm.
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.DS).uint32('waiting_for_output').
      call(0, VM.CPU.REGISTERS.CS).uint32('reset_output').
      ret();
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

  var output_dev_irq = info.output.irq;
  var output_dev_addr = info.output.addr;

  var ops = [];
  var fns = [];
  
  var STACK_SIZE = 4*1024;
  var DS_SIZE = 1024*2;
  var HEAP_REG = VM.CPU.REGISTERS.DS - 1;
  var EVAL_IP_REG = HEAP_REG - 1;
  var STATE_REG = HEAP_REG - 2;
  var PARAM_REG = HEAP_REG - 3;
  var TOS_REG = HEAP_REG - 4;
  var DICT_REG = HEAP_REG - 4;
  var FP_REG = HEAP_REG - 5;

  asm_isr(asm, VM.CPU.INTERRUPTS.user * 2);
  asm_memcpy(asm);

  function defop(name, fn) {
    ops.push(name);
    return fn(asm.label(name + "-code"));
  }

  function deffn(name, fn) {
    fns.push(name);
    return fn(
      asm.label(name + "-code").
          load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('call-data-code').
          label(name + '-ops')
    );
  }

  asm.label('isr_reset').
      call(0, VM.CPU.REGISTERS.CS).uint32('data_init').
      call(0, VM.CPU.REGISTERS.CS).uint32('output_init').
      call(0, VM.CPU.REGISTERS.CS).uint32('input_init').
      sie().
      call(0, VM.CPU.REGISTERS.CS).uint32('eval-init').
      mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.CS).
      inc(VM.CPU.REGISTERS.R0).uint32('bootstrap').
      push(VM.CPU.REGISTERS.R0).
      call(0, VM.CPU.REGISTERS.CS).uint32('outer-execute').
      //call(0, VM.CPU.REGISTERS.CS).uint32('bootstrap').
      call(0, VM.CPU.REGISTERS.CS).uint32('goodbye').
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('isr_reset');
  
  asm.label('goodbye').
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(BYE).
      call(0, VM.CPU.REGISTERS.CS).uint32('output_write_word').
      ret();
  
  asm.label('input_data_position', 0).
      label('output_data_position', 4).
      label('waiting_for_input', 8).
      label('waiting_for_output', 12).
      label('heap_top', 16).
      label('stack_top', 20);

  asm.label('data_init').
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(PARAM_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(VM.CPU.REGISTERS.DS, 0, VM.CPU.REGISTERS.INS).uint32(ds).
      load(VM.CPU.REGISTERS.CS, 0, VM.CPU.REGISTERS.INS).uint32(cs).
      mov(HEAP_REG, VM.CPU.REGISTERS.DS).
      inc(HEAP_REG).uint32(DS_SIZE).
      store(HEAP_REG, 0, VM.CPU.REGISTERS.DS).uint32('heap_top').
      pop(VM.CPU.REGISTERS.R0). // get return
      store(VM.CPU.REGISTERS.SP, 0, VM.CPU.REGISTERS.DS).uint32('stack_top').
      mov(VM.CPU.REGISTERS.IP, VM.CPU.REGISTERS.R0); // return

  defop('reboot', function(asm) {
    asm.reset();
  });
  
  defop('reset', function(asm) {
    asm.load(DICT_REG, 0, VM.CPU.REGISTERS.CS).uint32('dictionary').
        load(DICT_REG, 0, DICT_REG).uint32(0).
        load(HEAP_REG, 0, VM.CPU.REGISTERS.DS).uint32('heap_top').
        load(VM.CPU.REGISTERS.SP, 0, VM.CPU.REGISTERS.DS).uint32('stack_top').
        mov(FP_REG, VM.CPU.REGISTERS.SP).
        inc(VM.CPU.REGISTERS.R0).uint32('bootstrap').
        push(VM.CPU.REGISTERS.R0).
        call(0, VM.CPU.REGISTERS.CS).uint32('outer-execute');
  });
  
  input_asm(asm, input_dev_irq, input_dev_addr);
  output_asm(asm, output_dev_irq, output_dev_addr);

  asm.label('eval-init').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(PARAM_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(DICT_REG, 0, VM.CPU.REGISTERS.INS).uint32(TERMINATOR).
      // zero frame's link
      load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
      pop(VM.CPU.REGISTERS.R1).
      push(VM.CPU.REGISTERS.R0).
      mov(FP_REG, VM.CPU.REGISTERS.SP).
      push(VM.CPU.REGISTERS.R1).
      ret();

  asm.label('outer-execute').
      // swap return addr and EIP
      // and make a frame before pushing them back
      pop(VM.CPU.REGISTERS.R0). // return addr
      pop(VM.CPU.REGISTERS.R1). // eip to exec
      push(VM.CPU.REGISTERS.R0).
      push(VM.CPU.REGISTERS.R1).
      load(FP_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('exec-code').
      // mov(EVAL_IP_REG, VM.CPU.REGISTERS.R1).
      // load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('begin-code').
      ret();

  defop('jump', function(asm) {
    asm.pop(EVAL_IP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });

  defop('eip', function(asm) {
    asm.push(EVAL_IP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('exec', function(asm) {
    asm.pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.R0).uint32(4).
        ret();
  });
  
  defop('call-seq', function(asm) {
    asm.push(EVAL_IP_REG).
        load(EVAL_IP_REG, 0, VM.CPU.REGISTERS.SP).uint32(4).
        inc(EVAL_IP_REG).uint32(4).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('begin-code').
        ret();
  });
  
  defop('call-data', function(asm) {
    asm.push(VM.CPU.REGISTERS.R0).
        push(EVAL_IP_REG).
        //load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(4).
        load(EVAL_IP_REG, 0, VM.CPU.REGISTERS.R0).uint32(8).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('begin-code').
        ret();
  });

  // Start a new call frame.
  // Call frames are structured like, low memory to high:
  //    locals
  //    link to previous frame <- FP_REG -
  //    return address
  //    call arguments...
  //    caller's locals
  //    previous frame
  defop('begin', function(asm) {
    asm.push(FP_REG).
        mov(FP_REG, VM.CPU.REGISTERS.SP).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });

  // actually return from call
  defop('quit', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
        // get the top most stack frame
        label('quit-loop').
        load(VM.CPU.REGISTERS.R1, 0, FP_REG).uint32(0).
        cmpi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.R0).
        inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('quit-done', true).
        mov(FP_REG, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('quit-loop').
        label('quit-done').
        // move SP
        mov(VM.CPU.REGISTERS.SP, FP_REG).
        inc(VM.CPU.REGISTERS.SP).uint32(12).
        ret();
  });

  // Return to the calling function.
  defop('exit', function(asm) {
    asm.
        load(EVAL_IP_REG, 0, FP_REG).int32(4).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('end-code');
  });

  // Ends the current frame.
  defop('end', function(asm) {
    asm.load(FP_REG, 0, FP_REG).uint32(0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });

  // Load the next word, increment eval IP, and execute the word's code cell.
  defop('next', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, EVAL_IP_REG).int32(0).
        inc(EVAL_IP_REG).uint32(4).
        //callr(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.CS).
        /*
        cls(VM.CPU.STATUS.NUMERICS).
        addi(VM.CPU.REGISTERS.CS, VM.CPU.REGISTERS.STATUS).
        mov(VM.CPU.REGISTERS.IP, VM.CPU.REGISTERS.R0).
        */
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.R0).uint32(4).
        ret();
  });
  
  var FRAME_SIZE = 4 * 4;

  defop('returnN', function(asm) {
    asm.
        // copy values between FP and SP up over the frame
        // exit frame
        pop(VM.CPU.REGISTERS.R0). // N
        mov(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.SP).
        mov(VM.CPU.REGISTERS.SP, FP_REG).
        pop(FP_REG).
        pop(EVAL_IP_REG).
        pop(VM.CPU.REGISTERS.R2).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('shift-stack-code');
  });
  
  defop('shift-stack', function(asm) {
    asm.
        // R1: old SP
        // R0: number of bytes
        cls(VM.CPU.STATUS.NUMERICS).
        addi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.STATUS).
        label('shift-stack-loop').
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('next-code', true).
        dec(VM.CPU.REGISTERS.R0).uint32(4).
        load(VM.CPU.REGISTERS.R2, 0, VM.CPU.REGISTERS.R0).uint32(0).
        push(VM.CPU.REGISTERS.R2).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('shift-stack-loop');
  });
  
  defop('return1', function(asm) {
    asm.
        //load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(4).
        //push(VM.CPU.REGISTERS.R0).
        //load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('returnN').
        // save a return value
        pop(VM.CPU.REGISTERS.R0).
        // pop frame
        mov(VM.CPU.REGISTERS.SP, FP_REG).
        pop(FP_REG).
        pop(EVAL_IP_REG).
        // overwrite call's argument
        store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });

  defop('return2', function(asm) {
    asm.
        //load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(4).
        //push(VM.CPU.REGISTERS.R0).
        //load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('returnN').
        // save a return value
        pop(VM.CPU.REGISTERS.R0).
        pop(VM.CPU.REGISTERS.R1).
        // pop frame
        mov(VM.CPU.REGISTERS.SP, FP_REG).
        pop(FP_REG).
        pop(EVAL_IP_REG).
        // overwrite call's argument
        store(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.SP).uint32(0).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });

  defop('return-1', function(asm) {
    asm.
        // exit frame
        mov(VM.CPU.REGISTERS.SP, FP_REG).
        pop(FP_REG).
        pop(EVAL_IP_REG).
        pop(VM.CPU.REGISTERS.R0).
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('return0', function(asm) {
    asm.
        // exit frame
        mov(VM.CPU.REGISTERS.SP, FP_REG).
        pop(FP_REG).
        pop(EVAL_IP_REG).
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('tailcall', function(asm) {
    asm.
        // save where to call
        pop(VM.CPU.REGISTERS.R0).
        // pop frame
        mov(VM.CPU.REGISTERS.SP, FP_REG).
        pop(FP_REG).
        pop(EVAL_IP_REG).
        // overwrite call's argument
        store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(0).
        //push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('exec-code');
  });
  
  defop('cont', function(asm) {
    asm.
        // pop frame
        load(FP_REG, 0, FP_REG).uint32(0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('exec-code');
  });
  
  defop('tailcall1', function(asm) {
    asm.
        // save where to call
        pop(VM.CPU.REGISTERS.R0).
        // save the arg
        pop(VM.CPU.REGISTERS.R1).
        // pop frame
        mov(VM.CPU.REGISTERS.SP, FP_REG).
        pop(FP_REG).
        pop(EVAL_IP_REG).
        // overwrite call's argument
        store(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.SP).uint32(0).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('exec-code');
  });
  
  defop('call-op', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.IP);
  });
  
  defop('call-param', function(asm) {
    asm.
        push(EVAL_IP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('exec-code');
  });
  
  defop('call-op-param', function(asm) {
    asm.
        push(VM.CPU.REGISTERS.IP).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('exec-code');
  });
  
  defop('tailcall-param', function(asm) {
    asm.
        push(EVAL_IP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('tailcall-code');
  });
  
  defop('tailcall-op', function(asm) {
    asm.
        // save where to call
        pop(VM.CPU.REGISTERS.R0).
        //pop(VM.CPU.REGISTERS.R1).
        // pop frame
        mov(VM.CPU.REGISTERS.SP, FP_REG).
        pop(FP_REG).
        pop(EVAL_IP_REG).
        // overwrite call's argument
        store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(0).
        //store(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.SP).uint32(0).
        //push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('call-op');
  });
  
  defop('literal', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, EVAL_IP_REG).uint32(0).
        push(VM.CPU.REGISTERS.R0).
        inc(EVAL_IP_REG).uint32(4).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });

  defop('next-param', function(asm) {
    asm.
        // get the return address
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(4).
        // load the value
        load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.R0).uint32(0).
        push(VM.CPU.REGISTERS.R1).
        // move it up a cell
        inc(VM.CPU.REGISTERS.R0).uint32(4).
        // update it
        store(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(4).
        // done
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });

  defop('read-byte', function(asm) {
    asm.
        call(0, VM.CPU.REGISTERS.CS).uint32('read_byte').
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });
  
  defop('write-byte', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        call(0, VM.CPU.REGISTERS.CS).uint32('output_write_byte').
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });
  
  defop('write-word', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        call(0, VM.CPU.REGISTERS.CS).uint32('output_write_word').
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });

  defop('here', function(asm) {
    asm.
        push(VM.CPU.REGISTERS.SP).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('swap', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        pop(VM.CPU.REGISTERS.R1).
        push(VM.CPU.REGISTERS.R0).
        push(VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('drop', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });

  defop('drop2', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('drop3', function(asm) {
    asm.inc(VM.CPU.REGISTERS.SP).uint32(4 * 3).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('dup', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(0).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });
  
  defop('dup1', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });
  
  defop('dup2', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(8).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });
  
  defop('2dup', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('peek', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R0).uint32(0).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('poke', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0). // addr
        pop(VM.CPU.REGISTERS.R1). // value
        store(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.R0).uint32(0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('equals', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        pop(VM.CPU.REGISTERS.R1).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
        load(VM.CPU.REGISTERS.R0, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32(1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });
  
  var math_ops = { addi: 'int-add',
                   subi: 'int-sub',
                   muli: 'int-mul',
                   divi: 'int-div',
                   modi: 'int-mod'
                 }
  for(var k in math_ops) {
    var op = k;
    var label = math_ops[k];

    defop(label, function(asm) {
      asm.
          pop(VM.CPU.REGISTERS.R1).
          pop(VM.CPU.REGISTERS.R0).
          cls(VM.CPU.STATUS.NUMERICS);
      asm[op](VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.STATUS);
      asm.push(VM.CPU.REGISTERS.R0).
          load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
    });
  }

  defop('bsl', function(asm) {
    asm.pop(VM.CPU.REGISTERS.R1).
        pop(VM.CPU.REGISTERS.R0).
        cls(VM.CPU.STATUS.NUMERICS).
        bsl(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.STATUS).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('logand', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R1).
        pop(VM.CPU.REGISTERS.R0).
        and(VM.CPU.REGISTERS.R1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('logior', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R1).
        pop(VM.CPU.REGISTERS.R0).
        or(VM.CPU.REGISTERS.R1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('<', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R1).
        pop(VM.CPU.REGISTERS.R0).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
        load(VM.CPU.REGISTERS.R0, VM.CPU.STATUS.NEGATIVE, VM.CPU.REGISTERS.INS).uint32(1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('<=', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R1).
        pop(VM.CPU.REGISTERS.R0).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
        load(VM.CPU.REGISTERS.R0, VM.CPU.STATUS.NEGATIVE, VM.CPU.REGISTERS.INS).uint32(1).
        load(VM.CPU.REGISTERS.R0, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32(1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('>', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R1).
        pop(VM.CPU.REGISTERS.R0).
        cmpi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
        load(VM.CPU.REGISTERS.R0, VM.CPU.STATUS.NEGATIVE, VM.CPU.REGISTERS.INS).uint32(1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('>=', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R1).
        pop(VM.CPU.REGISTERS.R0).
        cmpi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
        load(VM.CPU.REGISTERS.R0, VM.CPU.STATUS.NEGATIVE, VM.CPU.REGISTERS.INS).uint32(1).
        load(VM.CPU.REGISTERS.R0, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32(1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('ifthenjump', function(asm) { // condition addr
    asm.
        pop(VM.CPU.REGISTERS.R2).
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32('next-code').
        mov(EVAL_IP_REG, VM.CPU.REGISTERS.R2).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code').
        ret();
  });
  
  defop('ifthencall', function(asm) {
    asm.
        // condition addr
        pop(VM.CPU.REGISTERS.R2).
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32('next-code').
        push(VM.CPU.REGISTERS.R2).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('exec-code').
        ret();
  });
  
  defop('pause', function(asm) {
    asm.
        cie().
        halt().
        sie().
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('args', function(asm) {
    asm.mov(VM.CPU.REGISTERS.R0, FP_REG).
        inc(VM.CPU.REGISTERS.R0).uint32(FRAME_SIZE - 4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('arg0', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(FRAME_SIZE - 4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('arg1', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(FRAME_SIZE).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('arg2', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(FRAME_SIZE + 4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('arg3', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(FRAME_SIZE + 8).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('local0', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(-4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('local1', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(-8).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('local2', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(-12).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('localn', function(asm) {
    asm.pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(4).
        cls(VM.CPU.STATUS.NUMERICS).
        muli(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.STATUS).
        mov(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.R0).
        mov(VM.CPU.REGISTERS.R0, FP_REG).
        cls(VM.CPU.STATUS.NUMERICS).
        subi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.STATUS).
        dec(VM.CPU.REGISTERS.R0).uint32(4).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R0).uint32(0).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('store-local0', function(asm) {
    asm.pop(VM.CPU.REGISTERS.R0).
        store(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(-4).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('store-local1', function(asm) {
    asm.pop(VM.CPU.REGISTERS.R0).
        store(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(-8).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('drop-frame', function(asm) {
    asm.
        inc(VM.CPU.REGISTERS.SP).uint32(FRAME_SIZE).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('dpush', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        inc(HEAP_REG).uint32(4).
        store(VM.CPU.REGISTERS.R0, 0, HEAP_REG).uint32(0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('dpop', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, HEAP_REG).uint32(0).
        dec(HEAP_REG).uint32(4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });

  defop('ddrop', function(asm) {
    asm.
        dec(HEAP_REG).uint32(4).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });

  defop('dmove', function(asm) {
    asm.pop(HEAP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('dhere', function(asm) {
    asm.
        push(HEAP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('current-frame', function(asm) {
    asm.
        push(FP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  deffn('parent-frame', function(asm) {
    asm.
        uint32('arg0').
        uint32('peek').
        uint32('return1');
  });
  
  defop('dict', function(asm) {
    asm.
        push(DICT_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('set-dict', function(asm) {
    asm.
        pop(DICT_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });

  defop('not', function(asm) {
    asm.pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.R1, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32(1).
        push(VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('lognot', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        not(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R0).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });

  asm.label('bootstrap-test-script').bytes(cellpad(
    "1.0 version constant\r\n"
    // + "def foo lit foo return1 ;\r\n"
    // + "lit foo def lit foo write-line return0 ;\r\n"
    // + "lit foo lookup ] lit foo write-line return0 [ set-colon-def \r\n"
    + "return0\r\n"
  ));
  
  asm.label('bootstrap-script').bytes(cellpad(
    //"zero *stop-tokenizing* defvar drop\r\n"
    "write-helo bootstrap-loop quit\r\n"
  ));

  deffn('bootstrap', function(asm) {
    asm.
        uint32('dict-init').
        //uint32('literal').uint32('bootstrap-script').
        //uint32('compile-string').
        //uint32('swap').uint32('drop').
        //uint32('call-seq').
        uint32('bootstrap-loop').
        uint32('return0');
  });

  deffn('next-param-test-inner', function(asm) {
    asm.uint32('next-param').
        uint32('write-word').
        uint32('next-param').
        uint32('write-word').
        uint32('next-param').
        uint32('write-word').
        uint32('return0');
  });

  asm.label('x-sym').bytes(cellpad('x'));
  
  deffn('next-param-test', function(asm) {
    asm.uint32('next-param-test-inner').uint32(longify(" BAM")).uint32(longify(" BOOM")).uint32(longify(" POW")).
        uint32('literal').uint32(123).
        uint32('const').uint32('x-sym').
        uint32('return1');
  });

  
  /* later
define
  next-word eip add-dict
  lit ; next-until jump

  asm.uint32('define').
      uint32('write-ok').
uint32('docode').
      uint32('literal').uint32(OK1).
      uint32('write-word').
      uint32('return0').
      uint32(';');

  asm.uint32('define').
      uint32('zero').
      uint32('literal').uint32(OK1).
      uint32('return1').
      uint32(';');
  */

  deffn('color-reset', function(asm) {
    asm.uint32('literal').uint32(longify('\x1B[00')).
        uint32('write-word').
        uint32('literal').uint32(longify('m\x00\x00\x00')).
        uint32('write-word').
        uint32('return0');
  });
  
  deffn('color-attr', function(asm) {
    asm.uint32('literal').uint32(longify('\x1B[00')).
        uint32('arg0').
        uint32('literal').uint32(24).
        uint32('bsl').
        uint32('int-add').
        uint32('write-word').
        uint32('literal').uint32(longify('m\x00\x00\x00')).
        uint32('write-word').
        uint32('return0');
  });
  
  deffn('color', function(asm) {
    asm.uint32('literal').uint32(longify('\x1B[30')).
        uint32('arg0').
        uint32('literal').uint32(24).
        uint32('bsl').
        uint32('int-add').
        uint32('write-word').
        uint32('literal').uint32(longify(';40m')).
        uint32('arg1').
        uint32('literal').uint32(16).
        uint32('bsl').
        uint32('int-add').
        uint32('write-word').
        uint32('return0');
  });

  deffn('fgcolor', function(asm) {
    asm.uint32('literal').uint32(longify('\x1B[00')).
        uint32('arg1').
        uint32('literal').uint32(24).
        uint32('bsl').
        uint32('int-add').
        uint32('write-word').
        uint32('literal').uint32(longify(';30m')).
        uint32('arg0').
        uint32('literal').uint32(16).
        uint32('bsl').
        uint32('int-add').
        uint32('write-word').
        uint32('return0');
  });

  deffn('bright', function(asm) {
    asm.uint32('literal').uint32(1).
        uint32('color-attr').
        uint32('return0');
  });
  
  deffn('red', function(asm) {
    asm.uint32('literal').uint32(8).
        uint32('literal').uint32(1).
        uint32('color').
        uint32('return0');
  });
  
  deffn('green', function(asm) {
    asm.uint32('literal').uint32(8).
        uint32('literal').uint32(2).
        uint32('color').
        uint32('return0');
  });

  deffn('yellow', function(asm) {
    asm.uint32('literal').uint32(8).
        uint32('literal').uint32(3).
        uint32('color').
        uint32('return0');
  });

  deffn('blue', function(asm) {
    asm.uint32('literal').uint32(8).
        uint32('literal').uint32(4).
        uint32('color').
        uint32('return0');
  });

  deffn('crnl', function(asm) {
    asm.uint32('literal').uint32(CRNL).
        uint32('return1');
  });
  deffn('write-crnl', function(asm) {
    asm.uint32('literal').uint32(CRNL).
        uint32('write-word').
        uint32('return0');
  });
  deffn('write-helo', function(asm) {
    asm.
        uint32('literal').uint32(HELO).
        uint32('write-word').
        uint32('return0');
  });
  deffn('write-ok', function(asm) {
    asm.uint32('bright').
        uint32('green').
        uint32('literal').uint32(OK1).
        uint32('write-word').
        uint32('color-reset').
        uint32('return0');
  });
  deffn('write-err', function(asm) {
    asm.uint32('bright').
        uint32('red').
        uint32('literal').uint32(ERR1).
        uint32('write-word').
        uint32('color-reset').
        uint32('return0');
  });

  deffn('lit', function(asm) {
    asm.uint32('read-token').uint32('return1');
  });

  deffn('prompt', function(asm) {
    asm.uint32('bright').
        uint32('yellow').
        uint32('literal').uint32(OK2).
        uint32('write-word').
        uint32('color-reset').
        uint32('return0');
  });
  
  deffn('bootstrap-loop', function(asm) {
    asm.label('bootstrap-loop-inner').
        uint32('write-ok').
        uint32('prompt').
        uint32('read-token').
        //uint32('write-string').
        //uint32('write-string-rev').
        uint32('dict').
        uint32('dict-lookup'). // fixme: dict and token are on stack during call, tail call needs to eat caller's frame?
        uint32('swap').uint32('drop').
        uint32('dup').
        uint32('not').
        uint32('literal').uint32('bootstrap-loop-not-found').
        uint32('ifthenjump').
        uint32('swap').uint32('drop').
        uint32('exec').
        uint32('literal').uint32('bootstrap-loop-inner').
        uint32('jump').
        uint32('exit');
    asm.label('bootstrap-loop-not-found').
        uint32('drop').
        uint32('literal').uint32('bootstrap-loop-inner').
        uint32('jump');
  });
  deffn('boo', function(asm) {
    asm.uint32('literal').uint32(longify('\nBOO')).
        uint32('write-word').
        uint32('literal').uint32(0).
        uint32('literal').uint32('boo-done').
        uint32('ifthenjump').
        uint32('write-err').
        label('boo-done').
        uint32('write-ok').
        uint32('literal').uint32(0x8765).
        uint32('return1');
  });
  
  deffn('make-dict', function(asm) {
    // name code data link => entry-ptr
    asm.
        uint32('arg3'). // name
        uint32('dpush').
        uint32('dhere').
        uint32('arg2'). // code
        uint32('dpush').
        uint32('arg1'). // data
        uint32('dpush').
        uint32('arg0'). // link
        uint32('dpush').
        uint32('return1'); // dhere
  });
  deffn('add-dict', function(asm) {
    // name code data
    asm.
        uint32('arg2').
        uint32('arg1').
        uint32('arg0').
        uint32('dict').
        uint32('make-dict').
        uint32('dup').
        uint32('set-dict').
        uint32('return1');
  });
  deffn('dict-entry-name', function(asm) {
    asm.uint32('arg0').
        uint32('peek').
        uint32('return1');
  });
  deffn('dict-entry-code', function(asm) {
    asm.uint32('arg0').
        uint32('cell+').
        uint32('peek').
        uint32('return1');
  });
  deffn('dict-entry-data', function(asm) {
    asm.uint32('arg0').
        uint32('cell+2').
        uint32('peek').
        uint32('return1');
  });
  deffn('set-dict-entry-code', function(asm) {
    // value entry
    asm.uint32('arg1').
        uint32('arg0').
        uint32('cell+').
        uint32('swap').uint32('drop').
        uint32('poke').
        uint32('return0');
  });
  deffn('set-dict-entry-data', function(asm) {
    // value entry
    asm.uint32('arg1').
        uint32('arg0').
        uint32('cell+2').
        uint32('swap').uint32('drop').
        uint32('poke').
        uint32('return0');
  });
  deffn('dict-entry-next', function(asm) {
    asm.uint32('arg0').
        uint32('cell+3').
        uint32('peek').
        uint32('return1');
  });
  deffn('dict-lookup', function(asm) {
    asm.
        uint32('arg0').
        label('dict-lookup-loop').
        uint32('terminator?').
        uint32('literal').uint32('dict-lookup-fail').
        uint32('ifthenjump').
        uint32('dict-entry-name').
        uint32('arg1').
        uint32('string-equal').
        uint32('literal').uint32('dict-lookup-found').
        uint32('ifthenjump').
        uint32('drop').
        uint32('drop').
        uint32('dict-entry-next').
        uint32('literal').uint32('dict-lookup-loop').
        uint32('jump');
    asm.label('dict-lookup-fail').
        uint32('literal').uint32(0).
        uint32('return1');
    asm.label('dict-lookup-found').
        //uint32('arg0').
        uint32('drop').
        uint32('drop').
        uint32('return1');
  });

  deffn('create', function(asm) {
    asm.uint32('arg0').
        uint32('literal').uint32(0).
        uint32('literal').uint32(0).
        uint32('add-dict').
        uint32('return1');
  });
  deffn('docol>', function(asm) {
    asm.uint32('literal').uint32('call-data-code').
        uint32('arg0').
        uint32('set-dict-entry-code').
        // todo enter compile mode
        uint32('return0');
  });

  deffn('\'', function(asm) {
    asm.uint32('lit').
        uint32('dict').
        uint32('dict-lookup').
        uint32('return1');
  });
  
  deffn('dict-each', function(asm) {
    asm.
        uint32('arg0').
        label('dict-each-loop').
        uint32('local0').
        uint32('terminator?').
        uint32('literal').uint32('dict-each-done').
        uint32('ifthenjump').
        uint32('arg1').
        uint32('exec').
        uint32('local0').
        uint32('dict-entry-next').
        uint32('store-local0').
        uint32('drop').
        uint32('literal').uint32('dict-each-loop').
        uint32('jump');
    asm.label('dict-each-done').
        uint32('return0');
  });

  deffn('write-dict-entry-name', function(asm) {
    asm.uint32('arg0').
        uint32('dict-entry-name').
        uint32('write-string').
        uint32('return0');
  });
  
  deffn('write-dict-entry-kind', function(asm) {
    asm.uint32('arg0').
        // functions
        uint32('dict-entry-code').
        uint32('literal').uint32('call-data-code').
        uint32('equals').
        uint32('literal').uint32('write-dict-entry-kind-func').
        uint32('ifthenjump').
        // vars
        uint32('dict-entry-code').
        uint32('literal').uint32('variable-peeker-code').
        uint32('equals').
        uint32('literal').uint32('write-dict-entry-kind-var').
        uint32('ifthenjump').
        // asm
        uint32('literal').uint32(longify("ASM\t")).
        uint32('write-word').
        uint32('return0');
    asm.label('write-dict-entry-kind-func').
        uint32('literal').uint32(longify("FUN\t")).
        uint32('write-word').
        uint32('return0');
    asm.label('write-dict-entry-kind-var').
        uint32('literal').uint32(longify("VAR\t")).
        uint32('write-word').
        uint32('return0');
  });
  
  deffn('write-dict-entry', function(asm) {
    asm.uint32('arg0').
        uint32('write-dict-entry-kind').
        uint32('write-dict-entry-name').
        uint32('write-crnl').
        uint32('return0');
  });
  
  deffn('dict-list', function(asm) {
    asm.uint32('literal').uint32('write-dict-entry').
        uint32('dict').
        uint32('dict-each').
        uint32('return0');
  });
  
  defop('rot', function(asm) {
    // a b c -> c b a
    asm.load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(0).
        load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.SP).uint32(8).
        store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(8).
        store(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.SP).uint32(0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });

  deffn('dict-init', function(asm) {
    asm.
        uint32('literal').uint32('dictionary').
        uint32('peek').
        uint32('set-dict').
        uint32('mark').
        uint32('return0');
  });
  
  deffn('string-equal', function(asm) {
    asm.
        // ptr-a ptr-b
        // lengths
        uint32('arg0').
        uint32('peek').
        uint32('arg1').
        uint32('peek').
        uint32('equals').
        // elements
        uint32('literal').uint32('string-equal-cmp').
        uint32('ifthenjump').
        // lengths are different
        uint32('literal').uint32(0).
        uint32('return1');
    asm.label('string-equal-cmp').
        uint32('arg0').
        uint32('arg1');
    asm.label('string-equal-loop').
        uint32('literal').uint32(4).
        uint32('int-add').
        uint32('swap').
        uint32('literal').uint32(4).
        uint32('int-add').
        uint32('swap').
        // read elements
        uint32('2dup').
        uint32('peek').
        uint32('swap').
        uint32('peek').
        // at the terminators?
        uint32('2dup').
        uint32('literal').uint32(TERMINATOR).
        uint32('equals').
        uint32('swap').
        uint32('literal').uint32(TERMINATOR).
        uint32('equals').
        uint32('logand').
        uint32('literal').uint32('string-equal-done').
        uint32('ifthenjump').
        // elements match?
        uint32('equals').
        uint32('literal').uint32('string-equal-loop').
        uint32('ifthenjump').
        // not equal
        uint32('literal').uint32(0).
        uint32('return1');
    asm.label('string-equal-done').
        uint32('literal').uint32(1).
        uint32('return1');
  });
  
  deffn('write-string', function(asm) {
    asm.
        //uint32('dup').
        uint32('arg0').
        uint32('literal').uint32(4).
        uint32('int-add').
        uint32('literal').uint32('write-string-loop').
        uint32('jump');
    asm.label('write-string-loop').
        uint32('dup').
        uint32('peek').
        uint32('dup').
        uint32('literal').uint32(TERMINATOR).
        uint32('equals').
        uint32('literal').uint32('write-string-done').
        uint32('ifthenjump').
        uint32('write-byte').
        uint32('literal').uint32(4).
        uint32('int-add').
        uint32('literal').uint32('write-string-loop').
        uint32('jump');
    asm.label('write-string-done').
        uint32('drop').
        uint32('drop').
        uint32('return0');
  });
  
  deffn('string-length', function(asm) {
    asm.
        uint32('arg0').
        uint32('peek').
        uint32('return1');
  });
  deffn('string-byte-size', function(asm) {
    asm.
        uint32('arg0').
        uint32('string-length').
        uint32('literal').uint32(4).
        uint32('int-mul').
        uint32('return1');
  });
  deffn('write-string-rev', function(asm) {
    asm.
        uint32('arg0').
        uint32('dup').
        uint32('dup').
        uint32('string-byte-size').
        uint32('int-add').
        uint32('literal').uint32('write-string-rev-loop').
        uint32('jump');
    asm.label('write-string-rev-loop').
        uint32('dup').
        uint32('peek').
        uint32('write-byte').
        uint32('literal').int32(-4).
        uint32('int-add').
        uint32('2dup').
        uint32('equals').
        uint32('literal').uint32('write-string-rev-done').
        uint32('ifthenjump').
        uint32('literal').uint32('write-string-rev-loop').
        uint32('jump');
    asm.label('write-string-rev-done').
        uint32('drop').
        uint32('drop').
        uint32('return0');
  });
  deffn('space?', function(asm) {
    asm.
        uint32('arg0').
        uint32('literal').uint32(' '.charCodeAt(0)).
        uint32('equals').
        uint32('return1');
  });
  deffn('or', function(asm) {
    asm.
        uint32('arg0').
        uint32('literal').uint32('or-done-0').
        uint32('ifthenjump').
        uint32('arg1').
        uint32('literal').uint32('or-done-1').
        uint32('ifthenjump').
        uint32('literal').uint32(0).
        uint32('return1').
        label('or-done-0').
        uint32('arg0').
        uint32('return1').
        label('or-done-1').
        uint32('arg1').
        uint32('return1');
  });
  deffn('set-arg0', function(asm) {
    asm.uint32('current-frame').
        uint32('parent-frame').
        uint32('parent-frame').
        uint32('literal').uint32(FRAME_SIZE - 4).
        uint32('int-add').
        uint32('arg0').
        uint32('poke').
        uint32('return-1');
  });
  deffn('set-arg1', function(asm) {
    asm.uint32('current-frame').
        uint32('parent-frame').
        uint32('parent-frame').
        uint32('literal').uint32(FRAME_SIZE).
        uint32('int-add').
        uint32('arg0').
        uint32('poke').
        uint32('return-1');
  });
  // todo how to swapdrop with a frame in the way?
  deffn('swapdrop', function(asm) {
    asm.
        uint32('arg0').
        uint32('set-arg1').
        uint32('return-1');
  });
  // asm.label('2swapdrop').
  //     uint32('literal').uint32('swapdrop').
  //     uint32('exec').
  //     uint32('literal').uint32('swapdrop').
  //     uint32('jump');
  deffn('whitespace?', function(asm) {
    asm.
        uint32('arg0').
        uint32('space?').
        uint32('swap').  // space? didn't eat the arg
        uint32('literal').uint32('\r'.charCodeAt(0)).
        uint32('equals').
        uint32('arg0'). // equals ate it
        uint32('literal').uint32('\n'.charCodeAt(0)).
        uint32('equals').
        uint32('arg0'). // equals ate it
        uint32('literal').uint32('\t'.charCodeAt(0)).
        uint32('equals').
        uint32('or').
        uint32('swap').uint32('drop').uint32('swap').uint32('drop').
        //uint32('literal').uint32('swapdrop').
        //uint32('exec').
        //uint32('literal').uint32('swapdrop').
        //uint32('exec').
        uint32('or').
        uint32('swap').uint32('drop').uint32('swap').uint32('drop').
        //uint32('literal').uint32('swapdrop').
        //uint32('exec').
        //uint32('literal').uint32('swapdrop').
        //uint32('exec').
        uint32('or').
        uint32('swap').uint32('drop').uint32('swap').uint32('drop').
        //uint32('literal').uint32('swapdrop').
        //uint32('exec').
        //uint32('literal').uint32('swapdrop').
        //uint32('exec').
        uint32('return1');
  });
  deffn('null?', function(asm) {
    asm.uint32('arg0').
        uint32('literal').uint32(0).
        uint32('equals').
        uint32('literal').uint32('null-yes').
        uint32('ifthenjump').
        uint32('arg0').
        uint32('literal').uint32(TERMINATOR).
        uint32('equals').
        uint32('literal').uint32('null-yes').
        uint32('ifthenjump').
        uint32('literal').uint32(0).
        uint32('return1');
    asm.label('null-yes').
        uint32('literal').uint32(1).
        uint32('return1');
  });
  deffn('terminator?', function(asm) {
    asm.uint32('arg0').
        uint32('literal').uint32(TERMINATOR).
        uint32('equals').
        uint32('literal').uint32('terminator-yes').
        uint32('ifthenjump').
        uint32('literal').uint32(0).
        uint32('return1');
    asm.label('terminator-yes').
        uint32('literal').uint32(1).
        uint32('return1');
  });
  deffn('in-range?', function(asm) {
    // (Max min value)
    asm.
        uint32('arg0').
        uint32('dup').
        uint32('arg1'). // min
        uint32('>=').
        uint32('literal').uint32('range-maybe').
        uint32('ifthenjump').
        uint32('drop').
        uint32('literal').uint32(0).
        uint32('return1');
    asm.label('range-maybe').
        uint32('arg2'). // max
        uint32('<=').
        uint32('literal').uint32('range-yes').
        uint32('ifthenjump').
        uint32('literal').uint32(0).
        uint32('return1');
    asm.label('range-yes').
        uint32('literal').uint32(1).
        uint32('return1');
  });
  deffn('digit?', function(asm) {
    asm.
        uint32('literal').uint32('9'.charCodeAt(0)).
        uint32('literal').uint32('0'.charCodeAt(0)).
        uint32('arg0').
        uint32('in-range?').
        uint32('return1');
  });
  deffn('lower-alpha?', function(asm) {
    asm.
        uint32('literal').uint32('z'.charCodeAt(0)).
        uint32('literal').uint32('a'.charCodeAt(0)).
        uint32('arg0').
        uint32('in-range?').
        uint32('return1');
  });
  deffn('upper-alpha?', function(asm) {
    asm.
        uint32('literal').uint32('Z'.charCodeAt(0)).
        uint32('literal').uint32('A'.charCodeAt(0)).
        uint32('arg0').
        uint32('in-range?').
        uint32('return1');
  });
  deffn('alpha?', function(asm) {
    asm.
        uint32('arg0').
        uint32('lower-alpha?').
        uint32('swap').
        uint32('upper-alpha?').
        uint32('swap').
        uint32('drop').
        uint32('or').
        uint32('return1');
  });
  deffn('digit-detected', function(asm) {
    asm.
        uint32('literal').uint32(longify('\r\nDI')).
        uint32('write-word').
        uint32('return0');
  });
  deffn('space-detected', function(asm) {
    asm.
        uint32('literal').uint32(longify('\r\nSP')).
        uint32('write-word').
        uint32('return0');
  });
  deffn('alpha-detected', function(asm) {
    asm.
        uint32('literal').uint32(longify('\r\nAL')).
        uint32('write-word').
        uint32('return0');
  });
  deffn('start-seq', function(asm) {
    asm.uint32('literal').uint32(0).
        uint32('dpush').
        uint32('dhere').
        uint32('return1');
  });

  deffn('end-seq', function(asm) {
    // seq
    asm.uint32('dhere').
        uint32('literal').uint32(TERMINATOR).
        uint32('dpush').
        uint32('arg0').
        uint32('int-sub').
        uint32('literal').uint32(4).
        uint32('int-div').
        uint32('arg0').
        uint32('poke').
        uint32('return0');
  });

  deffn('abort-seq', function(asm) {
    asm.uint32('arg0').
        uint32('dmove').
        uint32('ddrop').
        uint32('return0');
  });

  deffn('eat-spaces', function(asm) {
    asm.label('eat-spaces-loop').
        uint32('read-byte').
        uint32('whitespace?').
        uint32('literal').uint32('eat-spaces-reloop').
        uint32('ifthenjump').
        uint32('return1');
    asm.label('eat-spaces-reloop').
        uint32('drop').
        uint32('literal').uint32('eat-spaces-loop').
        uint32('jump');
  });
  deffn('read-token', function(asm) {
    asm.uint32('start-seq').
        uint32('eat-spaces').
        uint32('dpush').
        label('read-token-loop').
        uint32('read-byte').
        uint32('whitespace?').
        uint32('literal').uint32('read-token-done').
        uint32('ifthenjump').
        uint32('dpush').
        uint32('literal').uint32('read-token-loop').
        uint32('jump').
        label('read-token-done').
        uint32('drop').
        uint32('end-seq').
        uint32('return1');
  });
  deffn('tokenizer-next-word', function(asm) {
    asm.uint32('arg0').
        uint32('dup').
        uint32('peek').
        uint32('swap').
        uint32('literal').uint32(4).
        uint32('int-add').
        uint32('swap').
        uint32('return2');
  });
  deffn('tokenizer-eat-spaces', function(asm) {
    asm.
        uint32('arg0').
        label('tokenizer-eat-spaces-loop').
        uint32('tokenizer-next-word').
        uint32('whitespace?').
        uint32('literal').uint32('tokenizer-eat-spaces-reloop').
        uint32('ifthenjump').
        uint32('drop').
        uint32('drop').
        uint32('return1'); // old ptr
    asm.label('tokenizer-eat-spaces-reloop').
        uint32('drop').
        uint32('swap').
        uint32('drop'). // use new ptr
        uint32('literal').uint32('tokenizer-eat-spaces-loop').
        uint32('jump');
  });
  deffn('make-tokenizer', function(asm) {
    // string -> tokenizer ready string
    asm.uint32('arg0').
        uint32('literal').uint32(4).
        uint32('int-add').
        uint32('return1');
  });
  deffn('next-token', function(asm) {
    // tokenizer -> string-past-token token
    asm.
        uint32('arg0').
        uint32('tokenizer-eat-spaces').
        uint32('swap').uint32('drop').
        // start token
        uint32('start-seq').
        uint32('swap'). // token string
    label('tokenizer-loop').
        uint32('tokenizer-next-word'). // token string next-string byte
        uint32('null?').
        uint32('literal').uint32('tokenizer-eos').
        uint32('ifthenjump').
        uint32('whitespace?').
        uint32('literal').uint32('tokenizer-done').
        uint32('ifthenjump').
        uint32('dpush'). // token string next-string
        uint32('swap'). // token next-string string
        uint32('drop'). // token next-string
        uint32('literal').uint32('tokenizer-loop').
        uint32('jump');
    asm.label('tokenizer-eos').
        uint32('drop'). // last byte
        uint32('dup2'). // token string next-string token
        uint32('dhere').
        uint32('swap').
        uint32('int-sub').
        uint32('literal').uint32(4).
        uint32('<').
        uint32('literal').uint32('tokenizer-abort').
        uint32('ifthenjump').
        uint32('dup2'). // token string next-string token
        uint32('literal').uint32('tokenizer-done-done').
        uint32('jump');
    asm.label('tokenizer-abort').
        uint32('dup2'). // token string next-string token
        uint32('abort-seq').
        uint32('arg0').
        uint32('literal').uint32(0).
        uint32('return2');
    asm.label('tokenizer-done').  // token string next-string last-byte
        uint32('drop'). // token string next-string
        uint32('swap').
        uint32('drop'); // token next-string
    asm.label('tokenizer-done-done').
        uint32('swap'). // next-string token
        uint32('end-seq').
        uint32('return2'); // next-string token
  });
  deffn('read-line', function(asm) {
    asm.uint32('start-seq').
        uint32('literal').uint32('read-line-loop').
        uint32('jump');
    asm.label('read-line-loop').
        uint32('read-byte').
        uint32('dup').
        uint32('literal').uint32("\n".charCodeAt(0)).
        uint32('equals').
        uint32('literal').uint32('read-line-done').
        uint32('ifthenjump').
        uint32('dpush').
        uint32('literal').uint32('read-line-loop').
        uint32('jump');
    asm.label('read-line-done').
        uint32('dpush').
        uint32('end-seq').
        uint32('return1');
  });

  deffn('head-seq', function(asm) {
    asm.uint32('arg0').
        uint32('peek').
        uint32('return1');
  });

  deffn('tail-seq', function(asm) {
    asm.uint32('arg0').
        uint32('cell+').
        uint32('return1');
  });
  
  deffn('map-seq', function(asm) {
    asm.uint32('arg1').
        uint32('cell+').
        label('map-seq-loop').
        // seq
        uint32('head-seq'). // seq head
        uint32('terminator?').
        uint32('literal').uint32('map-seq-done').
        uint32('ifthenjump').
        uint32('arg0').
        //uint32('call-op'). // seq head result
        uint32('exec'). // seq head result
        uint32('swap'). // seq result head
        uint32('drop'). // seq result
        uint32('swap'). // result seq
        uint32('tail-seq'). // result seq tail
        uint32('swap'). // result tail seq
        uint32('drop'). // result tail
        uint32('literal').uint32('map-seq-loop').
        uint32('jump').
        label('map-seq-done').
        // todo pop of the results
        uint32('return0');
  });
  
  deffn('tokenize', function(asm) {
    asm.uint32('literal').uint32(TERMINATOR).
        uint32('arg0').
        uint32('make-tokenizer').
        uint32('swap').uint32('drop');
    asm.label('tokenize-loop').
        uint32('next-token').
        uint32('dup').
        uint32('not').
        uint32('literal').uint32('tokenize-done').
        uint32('ifthenjump').
        uint32('write-line').
        uint32('rot').
        uint32('drop').
        uint32('literal').uint32('tokenize-loop').
        uint32('jump');
    asm.label('tokenize-done').
        uint32('drop'). // the null token
        uint32('drop'). // the state
        uint32('drop'). // the old state
        // pop the tokens into a list
        uint32('start-seq');
    asm.label('tokenize-pop-loop').
        uint32('swap').
        uint32('terminator?').
        uint32('literal').uint32('tokenize-pop-loop-done').
        uint32('ifthenjump').
        uint32('dpush').
        uint32('literal').uint32('tokenize-pop-loop').
        uint32('jump');
    asm.label('tokenize-pop-loop-done').
        uint32('drop'). // terminator
        uint32('end-seq').
        uint32('return1');
  });

  deffn('each-token', function(asm) {
    // str fn
    asm.uint32('literal').uint32(TERMINATOR).
        uint32('arg1').
        uint32('make-tokenizer').
        uint32('swap').uint32('drop');
    asm.label('each-token-loop'). // tokenizer
        uint32('next-token'). // tokenizer next-tokenizer token
        uint32('dup').
        uint32('not').
        uint32('literal').uint32('each-token-done').
        uint32('ifthenjump').
        uint32('rot'). // token next-tokenizer tokenizer
        uint32('drop'). // token next-tokenizer
        uint32('literal').uint32('each-token-loop').
        uint32('jump');
    asm.label('each-token-done').
        uint32('drop'). // the null token
        uint32('drop'). // the state
        uint32('drop'). // the old state
        // pop the tokens into a list
        uint32('start-seq');
    asm.label('each-token-pop-loop'). // tokens... seq
        uint32('swap'). // tokens1... seq token0
        uint32('terminator?').
        uint32('literal').uint32('each-token-pop-loop-done').
        uint32('ifthenjump').
        uint32('arg0'). // seq token0 fn
        //uint32('call-op'). // seq token0 result
        uint32('exec'). // seq token0 result
        uint32('dpush'). // seq token0
        uint32('drop').
        uint32('literal').uint32('each-token-pop-loop').
        uint32('jump');
    asm.label('each-token-pop-loop-done').
        uint32('drop'). // terminator
        uint32('end-seq').
        uint32('return1');
  });  

  deffn('immediate-lookup', function(asm) {
    asm.uint32('arg0').
        uint32('immediate-dict').
        uint32('dict-lookup').
        uint32('return1');
  });

  deffn('immediate-dict', function(asm) {
    asm.uint32('literal').uint32('immediate-dictionary').
        uint32('peek').
        uint32('return1');
  });

  deffn('immediate-dict-add', function(asm) {
    asm.uint32('arg2').
        uint32('arg1').
        uint32('arg0').
        uint32('immediate-dict').
        uint32('make-dict').
        uint32('literal').uint32('immediate-dict-sym').
        uint32('set-var').
        uint32('drop').
        uint32('return1');
  });
  
  deffn('immediate', function(asm) {
    asm.uint32('arg0').
        uint32('dict-entry-name').
        uint32('swap').
        uint32('dict-entry-code').
        uint32('swap').
        uint32('dict-entry-data').
        uint32('swap').
        uint32('drop').
        uint32('immediate-dict-add').
        uint32('return0');
  });

  deffn('write-line', function(asm) {
    asm.uint32('arg0').
        uint32('write-string').
        uint32('write-crnl').
        uint32('return0');
  });

  deffn('write-line-ret', function(asm) {
    asm.uint32('arg0').
        uint32('write-string').
        uint32('write-crnl').
        uint32('literal').uint32(0).
        uint32('return1');
  });

  deffn('write-seq', function(asm) {
    asm.uint32('arg0').
        uint32('literal').uint32('write-line-ret').
        uint32('map-seq').
        uint32('return0');
  });
  
  deffn('write-tokens', function(asm) {
    asm.uint32('arg0').
        uint32('literal').uint32('write-line-ret').
        uint32('each-token').
        uint32('return0');
  });
  
  deffn('write-tokens1', function(asm) {
    asm.uint32('arg0').
        uint32('tokenize').
        uint32('literal').uint32('write-line-ret').
        uint32('map-seq').
        uint32('return0');
  });

  /*
  defop('indirect-param', function(asm) {
    asm.mov(VM.CPU.REGISTERS.R0, EVAL_IP_REG).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R0).uint32(4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  deffn('indirect-param', function(asm) {
    asm.uint32('eip').
        uint32('peek').
        uint32('dict-entry-data').
        uint32('cell+').
        uint32('return1');
  });
  */

  deffn('emit-call-param', function(asm) {
    // emit:
    // load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(name + '-ops').
    // push(VM.CPU.REGISTERS.R0).
    // load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('exec').
    asm.uint32('literal').nop().mov(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.IP).
        uint32('dpush').
        uint32('literal').nop().inc(VM.CPU.REGISTERS.R0).
        uint32('dpush').
        uint32('literal').uint32(6).
        uint32('dpush').
        uint32('literal').push(VM.CPU.REGISTERS.R0).mov(VM.CPU.REGISTERS.IP, VM.CPU.REGISTERS.R0).
        uint32('dpush').
        uint32('literal').uint32('call-data-code').
        uint32('dpush').
        uint32('return0');
  });
  
  deffn('constant-capturer', function(asm) {
    asm.uint32('start-seq').
        uint32('literal').uint32('literal').
        uint32('dpush').
        uint32('arg0').
        uint32('dpush').
        uint32('literal').uint32('return1').
        uint32('dpush').
        uint32('end-seq').
        uint32('cell+').
        uint32('return1');
  });
  
  deffn('constant', function(asm) {
    // value name
    asm.uint32('arg0').
        uint32('literal').uint32('call-data-code').
        uint32('arg1').
        uint32('constant-capturer').
        uint32('swap').uint32('drop').
        uint32('add-dict').
        uint32('return0');
  });

  deffn('const', function(asm) {
    // value : name
    asm.uint32('next-param').
        uint32('literal').uint32('call-data-code').
        uint32('arg0').
        uint32('constant-capturer').
        uint32('swap').uint32('drop').
        uint32('add-dict').
        uint32('return0');
  });

  /*
  deffn('variable-peeker', function(asm) {
    asm.uint32('start-seq').
        uint32('emit-call-param').
        uint32('literal').uint32('literal').
        uint32('dpush').
        uint32('arg0').
        uint32('dpush').
        uint32('literal').uint32('dict').
        uint32('dpush').
        uint32('literal').uint32('dict-lookup').
        uint32('dpush').
        uint32('literal').uint32('dict-entry-data').
        uint32('dpush').
        uint32('literal').uint32('return1').
        uint32('dpush').
        uint32('end-seq').
        uint32('cell+').
        uint32('return1');
  });
*/
  
  defop('variable-peeker', function(asm) {
    asm.load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R0).uint32(8).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  deffn('dovar', function(asm) {
    // entry
    asm.uint32('literal').uint32('variable-peeker-code').
        uint32('arg0').
        uint32('set-dict-entry-code').
        uint32('return0');
  });

  deffn('defvar', function(asm) {
    // value name
    asm.uint32('arg0').
        uint32('literal').uint32('variable-peeker-code').
        uint32('arg1').
        uint32('add-dict').
        uint32('return1');
  });

  deffn('set-var', function(asm) {
    // value name
    // return the entry
    // lookup if not found then define
    asm.uint32('arg0').
        uint32('dict').
        uint32('dict-lookup').
        uint32('null?').
        uint32('literal').uint32('set-not-found').
        uint32('ifthenjump').
        // found
        uint32('arg1').
        uint32('swap').
        uint32('set-dict-entry-data').
        // make sure the code is a variable's
        uint32('literal').uint32('variable-peeker-code').
        uint32('swap').
        uint32('set-dict-entry-code').
        uint32('return1');
    // else set data
    asm.label('set-not-found').
        uint32('arg1').
        uint32('arg0').
        uint32('defvar').
        uint32('return1');
  });

  asm.label('the-mark-sym').bytes(cellpad('*mark*'));
  
  deffn('mark', function(asm) {
    asm.uint32('dict').
        uint32('literal').uint32('the-mark-sym').
        uint32('constant').
        uint32('return0');
  });

  deffn('forget', function(asm) {
    asm.uint32('literal').uint32('the-mark-sym').
        uint32('dict').
        uint32('dict-lookup').
        uint32('dict-entry-data').
        uint32('set-dict').
        uint32('return0');
  });

  deffn('dict-forget', function(asm) {
    // name dict
    // find parent
    // link parent to child
  });

  deffn('peeker', function(asm) {
    // addr
    asm.uint32('start-seq').
        uint32('emit-call-param').
        uint32('literal').uint32('literal').
        uint32('dpush').
        uint32('arg0').
        uint32('dpush').
        uint32('literal').uint32('peek').
        uint32('dpush').
        uint32('literal').uint32('return1').
        uint32('dpush').
        uint32('end-seq').
        uint32('cell+').
        uint32('return1');
  });

  defop('pointer-peeker', function(asm) {
    asm.load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R0).uint32(8).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R0).uint32(0).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  deffn('args1', function(asm) {
    asm.uint32('args').
        uint32('cell+').
        uint32('return1');
  });
  
  deffn('local-ref', function(asm) {
    // the-location name => entry
    asm.uint32('arg0').
        uint32('literal').uint32('pointer-peeker-code').
        uint32('args').
        uint32('cell+').
        uint32('swap').uint32('drop').
        uint32('add-dict').
        uint32('return0');
  });

  deffn('store-local-ref', function(asm) {
    // value entry
    asm.uint32('arg0').
        uint32('dict-entry-data').
        uint32('arg1').
        uint32('swap').
        uint32('poke').
        uint32('return0');
  });
  
  deffn('e-lit', function(asm) {
    asm. // get tokenizer
        uint32('*tokenizer*').
        //uint32('dup').
        //uint32('exec'). // tokenizer
        // read a token
        uint32('next-token'). // tokenizer new-tokenizer token
        uint32('rot'). // token new-tokenizer tokenizer
        uint32('drop'). // token new-tokenizer
        // update *tokenizer*
        uint32('literal').uint32('the-tokenizer-sym').
        uint32('set-var').
        // make a return
        uint32('drop'). // token tokenizer sym entry
        uint32('drop'). // token tokenizer sym
        uint32('drop'). // token
        uint32('return1');
  });
  
  deffn('eval-string', function(asm) {
    // str
    asm.uint32('arg0').
        uint32('make-tokenizer').
        uint32('swap').uint32('drop'). // tokenizer
        uint32('literal').uint32('the-tokenizer-sym').
        uint32('set-var').
        uint32('drop').
        uint32('drop');
    asm.label('eval-string-inner').
        uint32('local0').
        uint32('next-token'). // tokenizer new-tokenizer token
        uint32('rot'). // token new-tokenizer tokenizer
        uint32('drop'). // token new-tokenizer
        uint32('store-local0'). // token
        uint32('null?').
        uint32('literal').uint32('eval-string-done').
        uint32('ifthenjump').
        uint32('dict').
        uint32('dict-lookup'). // token dict lookup; fixme: tail call needs to eat caller's frame?
        uint32('swap').
        uint32('drop'). // token lookup
        uint32('dup'). // token lookup lookup
        uint32('not').
        uint32('literal').uint32('eval-string-not-found').
        uint32('ifthenjump').
        uint32('swap'). // lookup token
        uint32('drop'). // lookup
        uint32('exec'). // expecting no return
        uint32('literal').uint32('eval-string-inner').
        uint32('jump');
    asm.label('eval-string-not-found'). // token lookup
        uint32('drop'). // token
        uint32('literal').uint32('eval-string-inner').
        uint32('jump');
    asm.label('eval-string-done'). // token
        uint32('return0');
  });

  deffn('unset-tokenizer-stop-flag', function(asm) {
    asm.uint32('literal').uint32(0).
        uint32('literal').uint32('*stop-tokenizing*-sym').
        uint32('set-var').
        uint32('return0');
  });

  deffn('set-tokenizer-stop-flag', function(asm) {
    asm.uint32('literal').uint32(1).
        uint32('literal').uint32('*stop-tokenizing*-sym').
        uint32('set-var').
        uint32('return0');
  });

  deffn('compile-execute', function(asm) {
    // token
    asm.uint32('arg0').
        uint32('null?').
        uint32('pause').
        uint32('literal').uint32('compile-execute-done').
        uint32('ifthenjump').
        uint32('immediate-lookup'). // token lookup; fixme: tail call needs to eat caller's frame?
        uint32('dup'). // token lookup lookup
        uint32('not').
        uint32('literal').uint32('compile-execute-not-found').
        uint32('ifthenjump').
        uint32('swap'). // lookup token
        uint32('drop'). // lookup
        uint32('tailcall1');
    asm.label('compile-execute-not-found'). // token lookup
        uint32('drop'). // token
        uint32('dict').
        uint32('dict-lookup'). // token dict lookup; fixme: tail call needs to eat caller's frame?
        uint32('swap').
        uint32('drop'). // token lookup
        uint32('dup'). // token lookup lookup
        uint32('not').
        uint32('literal').uint32('compile-execute-not-found2').
        uint32('ifthenjump').
        uint32('swap'). // lookup token
        uint32('drop'). // lookup
        uint32('pause').
        uint32('return1');
    asm.label('compile-execute-not-found2'). // token lookup
        uint32('drop'). // token
        uint32('literal').uint32('literal').
        uint32('swap').
        uint32('pause').
        uint32('return1');
    asm.label('compile-execute-done').
        uint32('drop').
        uint32('pause').
        uint32('return1');
  });
  deffn('compile-string', function(asm) {
    // str
    asm.uint32('arg0').
        uint32('make-tokenizer').
        uint32('swap').uint32('drop'). // tokenizer
        uint32('literal').uint32('the-tokenizer-sym').
        uint32('set-var').
        uint32('drop').
        uint32('drop').
        uint32('unset-tokenizer-stop-flag').
        uint32('here').
        uint32('literal').uint32('compile-string-inner').
        uint32('tailcall1');
  });

  deffn('compile-string-inner', function(asm) {
    asm. //label('compile-string-inner').
        uint32('*stop-tokenizing*').
        uint32('literal').uint32('compile-string-done').
        uint32('ifthenjump').
        uint32('*tokenizer*').
        uint32('next-token'). // tokenizer new-tokenizer token
        uint32('rot'). // token new-tokenizer tokenizer
        uint32('drop'). // token new-tokenizer
        uint32('literal').uint32('the-tokenizer-sym').
        uint32('set-var'). // token new-tok sym entry
        uint32('drop3'). // token
        uint32('null?').
        uint32('literal').uint32('compile-string-done').
        uint32('ifthenjump').
        uint32('write-line').
        uint32('pause').
        uint32('compile-execute').
        uint32('literal').uint32('compile-string-inner-code').
        uint32('jump');
    asm.label('compile-string-done'). // nulltoken
        uint32('drop').
        uint32('arg0').
        uint32('cell-2').
        uint32('pause').
        uint32('pop-to-seq').
        uint32('pause').
        uint32('return1');
  });

  deffn('pop-to-seq', function(asm) {
    // start-ptr
    asm.uint32('start-seq').
        uint32('arg0').
        uint32('args').
        uint32('cell+2').
        uint32('swap').uint32('drop');
    asm.label('pop-to-seq-loop').
        uint32('local1').
        uint32('peek').
        uint32('dpush').
        uint32('local1').
        uint32('local2').
        uint32('<=').
        uint32('literal').uint32('pop-to-seq-done').
        uint32('ifthenjump').
        uint32('local1').
        uint32('cell-').
        uint32('store-local1').
        uint32('drop').
        uint32('literal').uint32('pop-to-seq-loop').
        uint32('jump');
    asm.label('pop-to-seq-done').
        uint32('local0').
        uint32('end-seq').
        uint32('return1');
  });

  deffn(']', function(asm) {
    asm.uint32('read-line').
        uint32('compile-string').
        uint32('return1');
  });

  deffn(']_', function(asm) {
    asm.uint32('*tokenizer*').
        uint32('compile-string').
        uint32('return1');
  });

  deffn('[', function(asm) {
    asm.uint32('literal').uint32(1).
        uint32('literal').uint32('*stop-tokenizing*-sym').
        uint32('set-var').
        uint32('return0');
  });
  
  // fixme needs to write numbers
  deffn('decompile-write', function(asm) {
    asm.uint32('arg0').
        uint32('terminator?').
        uint32('literal').uint32('decompile-write-done').
        uint32('ifthenjump').
        uint32('dict-entry-name').
        uint32('write-line').
        uint32('return0').
        label('decompile-write-done').
        uint32('literal').uint32(longify(' NUL')).
        uint32('write-word').
        uint32('return0');
  });
  
  deffn('decompile-seq', function(asm) {
    asm.uint32('arg0').
        uint32('literal').
        uint32('decompile-write').
        uint32('map-seq').
        uint32('return0');
  });

  defop('input-flush', function(asm) {
    asm.call(0, VM.CPU.REGISTERS.CS).uint32('input_flush').
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  defop('input-reset', function(asm) {
    asm.call(0, VM.CPU.REGISTERS.CS).uint32('reset_input').
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
  });
  
  deffn('flush-read-line', function(asm) {
    asm.uint32('input-reset').
        uint32('read-line').
        uint32('input-reset').
        uint32('return1');
  });

  deffn('zero', function(asm) {
    asm.uint32('literal').uint32(0).
        uint32('return1');
  });
  deffn('false', function(asm) {
    asm.uint32('literal').uint32(0).
        uint32('return1');
  });
  deffn('terminator', function(asm) {
    asm.uint32('literal').uint32(TERMINATOR).
        uint32('return1');
  });
  deffn('one', function(asm) {
    asm.uint32('literal').uint32(1).
        uint32('return1');
  });
  deffn('true', function(asm) {
    asm.uint32('literal').uint32(1).
        uint32('return1');
  });

  deffn('cell-size', function(asm) {
    asm.uint32('literal').uint32(4).
        uint32('return1');
  });

  deffn('cell+', function(asm) {
    asm.uint32('cell-size').
        uint32('arg0').
        uint32('int-add').
        uint32('return1');
  });

  deffn('cell+n', function(asm) {
    asm.uint32('cell-size').
        uint32('arg0').
        uint32('int-mul').
        uint32('arg1').
        uint32('int-add').
        uint32('return1');
  });

  deffn('cell+2', function(asm) {
    asm.uint32('arg0').
        uint32('literal').uint32(2).
        uint32('cell+n').
        uint32('return1');
  });

  deffn('cell+3', function(asm) {
    asm.uint32('arg0').
        uint32('literal').uint32(3).
        uint32('cell+n').
        uint32('return1');
  });
  
  deffn('cell-', function(asm) {
    asm.uint32('arg0').
        uint32('cell-size').
        uint32('int-sub').
        uint32('return1');
  });

  deffn('cell-2', function(asm) {
    asm.uint32('arg0').
        uint32('literal').uint32(-2).
        uint32('cell+n').
        uint32('return1');
  });

  deffn('tail-call-test-1', function(asm) {
    asm.uint32('arg0').
        uint32('literal').uint32(0).
        uint32('equals').
        uint32('literal').uint32('tail-call-test-1-done').
        uint32('ifthenjump').
        uint32('literal').uint32(HELO).
        uint32('write-word').
        uint32('arg0').
        uint32('literal').uint32(1).
        uint32('int-sub').
        uint32('literal').uint32('tail-call-test-1').
        uint32('tailcall1');
    asm.label('tail-call-test-1-done').
        uint32('arg0').
        uint32('return1');
  });

  deffn('tail-call-test', function(asm) {
    asm.uint32('literal').uint32(longify('\r\nGO')).
        uint32('write-word').
        uint32('arg0').
        uint32('literal').uint32('tail-call-test-1').
        uint32('tailcall1');
  });

  deffn('cont-test', function(asm) {
    asm.uint32('literal').uint32('write-line').
        uint32('pause').
        uint32('cont');
  });
  
  asm.label('program-size');

  asm.label('symbols-begin');

  // Variable names
  asm.label('the-tokenizer-sym').label('*tokenizer*-sym').bytes(cellpad('*tokenizer*'));
  asm.label('*stop-tokenizing*-sym').bytes(cellpad('*stop-tokenizing*'));
  asm.label('helo-sym').bytes(cellpad("helo"));
  
  for(var n in ops) {
    var label = ops[n];
    asm.label(label + '-sym').bytes(cellpad(label));
  }

  for(var n in fns) {
    var label = fns[n];
    asm.label(label + '-sym').bytes(cellpad(label));
  }

  asm.label('symbols-end');
  asm.label('symbols-size').uint32(asm.resolve('symbols-end') - asm.resolve('symbols-begin'));
  
  asm.label('dictionary-begin');

  function dict_entry(label, code, data, last_label) {
    var label_def = label + '-def';
    
    asm.label(label).
        uint32(label + '-sym').
        uint32(code).
        uint32(data).
        uint32(last_label);
    
    return label;
  }

  function dict_entry_op(label, last_label) {
    return dict_entry(label, label + "-code", 0, last_label);
  }

  function dict_entry_fn(label, last_label) {
    return dict_entry(label, 'call-data-code', label + "-ops", last_label);
  }

  var last_label = TERMINATOR;

  for(var n in ops) {
    var label = ops[n];
    last_label = dict_entry_op(label, last_label);
  }

  for(var n in fns) {
    var label = fns[n];
    last_label = dict_entry_fn(label, last_label);
  }

  // Variables
  last_label = dict_entry('*tokenizer*', 'variable-peeker-code', 0, last_label);
  last_label = dict_entry('*stop-tokenizing*', 'variable-peeker-code', 0, last_label);

  asm.label('dictionary-end');
  asm.label('dictionary').
      uint32(last_label);
  asm.label('dictionary-size').uint32(asm.resolve('dictionary-end') - asm.resolve('dictionary-begin'));

  asm.label('toklit-sym').bytes(cellpad('lit'));
  asm.label('toklit-code').
      halt().
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next-code');
      
  asm.label('tok-write-sym').bytes(cellpad('.'));
  asm.label('tok-e-lit-sym').bytes(cellpad('literal'));
      
  last_label = TERMINATOR;
  last_label = dict_entry('toklit', 'toklit-code', 0, last_label);
  last_label = dict_entry('tok-write', 'call-data-code', 'write-line-ops', last_label);
  last_label = dict_entry('tok-e-lit', 'call-data-code', 'e-lit-ops', last_label);
  
  asm.label('immediate-dictionary').uint32(last_label);
  
  /*
  asm.label('image-size').
      uint32('program-size').
      uint32('dictionary-size').
      uint32('symbols-size').
      uint32('image-size');
*/
  
  return asm;
}

Forth.assemble = function(ds, cs, info) {
  return Forth.assembler(ds, cs, info).assemble();
}

Forth.longify = longify;
Forth.cellpad = cellpad;

if(typeof(module) != 'undefined') {
  module.exports = Forth;
}

if(typeof(window) != 'undefined') {
  window.Forth = Forth;
}
