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
    return fn(asm.label(name));
  }

  function deffn(name, fn) {
    fns.push(name);
    return fn(
      asm.label(name).
          load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(name + '-ops').
          push(VM.CPU.REGISTERS.R0).
          load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('call').
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
      label('heap_top', 16);

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
      ret();
  
  input_asm(asm, input_dev_irq, input_dev_addr);
  output_asm(asm, output_dev_irq, output_dev_addr);

  asm.label('eval-init').
      load(TOS_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(PARAM_REG, 0, VM.CPU.REGISTERS.INS).uint32(0).
      load(DICT_REG, 0, VM.CPU.REGISTERS.INS).uint32(TERMINATOR).
      mov(FP_REG, VM.CPU.REGISTERS.SP).
      ret();

  asm.label('outer-execute').
      // swap return addr and EIP
      pop(VM.CPU.REGISTERS.R0).
      pop(VM.CPU.REGISTERS.R1).
      push(VM.CPU.REGISTERS.R0).
      //push(VM.CPU.REGISTERS.R1).
      //load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('call').
      mov(VM.CPU.REGISTERS.IP, VM.CPU.REGISTERS.R1).
      ret();

  defop('jump', function(asm) {
    asm.pop(EVAL_IP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });

  defop('eip', function(asm) {
    asm.push(EVAL_IP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('call', function(asm) {
    asm.push(EVAL_IP_REG).
        load(EVAL_IP_REG, 0, VM.CPU.REGISTERS.SP).uint32(4).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('begin').
        ret();
  });
  
  defop('begin', function(asm) {
    asm.push(FP_REG).
        mov(FP_REG, VM.CPU.REGISTERS.SP).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });
  
  asm.label('quit').
      // actually return from call
      load(VM.CPU.REGISTERS.IP, 0, FP_REG).uint32(12).
      ret();

  defop('exit', function(asm) {
    asm.
        load(EVAL_IP_REG, 0, FP_REG).int32(4).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('end');
  });
  
  defop('end', function(asm) {
    asm.mov(VM.CPU.REGISTERS.SP, FP_REG).
        pop(FP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });

  defop('next', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, EVAL_IP_REG).int32(0).
        inc(EVAL_IP_REG).uint32(4).
        //callr(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.CS).
        cls(VM.CPU.STATUS.NUMERICS).
        addi(VM.CPU.REGISTERS.CS, VM.CPU.REGISTERS.STATUS).
        mov(VM.CPU.REGISTERS.IP, VM.CPU.REGISTERS.R0).
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
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('shift-stack');
  });
  
  defop('shift-stack', function(asm) {
    asm.
        // R1: old SP
        // R0: number of bytes
        cls(VM.CPU.STATUS.NUMERICS).
        addi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.STATUS).
        label('shift-stack-loop').
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        inc(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO).uint32('next', true).
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
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
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
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });

  defop('return-1', function(asm) {
    asm.
        // exit frame
        mov(VM.CPU.REGISTERS.SP, FP_REG).
        pop(FP_REG).
        pop(EVAL_IP_REG).
        pop(VM.CPU.REGISTERS.R0).
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('return0', function(asm) {
    asm.
        // exit frame
        mov(VM.CPU.REGISTERS.SP, FP_REG).
        pop(FP_REG).
        pop(EVAL_IP_REG).
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
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
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('call');
  });
  
  defop('call-op', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.IP);
  });
  
  defop('call-param', function(asm) {
    asm.
        push(EVAL_IP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('call');
  });
  
  defop('call-op-param', function(asm) {
    asm.
        push(VM.CPU.REGISTERS.IP).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('call');
  });
  
  defop('tailcall-param', function(asm) {
    asm.
        push(EVAL_IP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('tailcall');
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
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });

  defop('direct-param', function(asm) {
    asm.
        // get the return address
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(0).
        // load the value
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R0).uint32(0).
        push(VM.CPU.REGISTERS.R0).
        // move it up a cell
        inc(VM.CPU.REGISTERS.R0).uint32(4).
        // update it
        store(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(0).
        // done
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });

  defop('read-byte', function(asm) {
    asm.
        call(0, VM.CPU.REGISTERS.CS).uint32('read_byte').
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });
  
  defop('write-byte', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        call(0, VM.CPU.REGISTERS.CS).uint32('output_write_byte').
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });
  
  defop('write-word', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        call(0, VM.CPU.REGISTERS.CS).uint32('output_write_word').
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });

  defop('here', function(asm) {
    asm.
        push(VM.CPU.REGISTERS.SP).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('swap', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        pop(VM.CPU.REGISTERS.R1).
        push(VM.CPU.REGISTERS.R0).
        push(VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('drop', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('dup', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(0).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });
  
  defop('dup1', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });
  
  defop('dup2', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(8).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });
  
  defop('2dup', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('peek', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.R0).uint32(0).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('poke', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0). // addr
        pop(VM.CPU.REGISTERS.R1). // value
        store(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.R0).uint32(0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('equals', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        pop(VM.CPU.REGISTERS.R1).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
        load(VM.CPU.REGISTERS.R0, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32(1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
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
          load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
    });
  }

  defop('logand', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R1).
        pop(VM.CPU.REGISTERS.R0).
        and(VM.CPU.REGISTERS.R1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('logior', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R1).
        pop(VM.CPU.REGISTERS.R0).
        or(VM.CPU.REGISTERS.R1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('<', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R1).
        pop(VM.CPU.REGISTERS.R0).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
        load(VM.CPU.REGISTERS.R0, VM.CPU.STATUS.NEGATIVE, VM.CPU.REGISTERS.INS).uint32(1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
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
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('>', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R1).
        pop(VM.CPU.REGISTERS.R0).
        cmpi(VM.CPU.REGISTERS.R1, VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0).
        load(VM.CPU.REGISTERS.R0, VM.CPU.STATUS.NEGATIVE, VM.CPU.REGISTERS.INS).uint32(1).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
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
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('ifthenjump', function(asm) { // condition addr
    asm.
        pop(VM.CPU.REGISTERS.R2).
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32('next').
        mov(EVAL_IP_REG, VM.CPU.REGISTERS.R2).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next').
        ret();
  });
  
  defop('ifthenop', function(asm) { // condition addr
    asm.pop(VM.CPU.REGISTERS.R2).
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32('next').
        mov(VM.CPU.REGISTERS.IP, VM.CPU.REGISTERS.R2).
        ret();
  });
  
  defop('ifthencall', function(asm) {
    asm.
        // condition addr
        pop(VM.CPU.REGISTERS.R2).
        pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.IP, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32('next').
        push(VM.CPU.REGISTERS.R2).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('call').
        ret();
  });
  
  defop('pause', function(asm) {
    asm.
        cie().
        halt().
        sie().
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('args', function(asm) {
    asm.mov(VM.CPU.REGISTERS.R0, FP_REG).
        inc(VM.CPU.REGISTERS.R0).uint32(FRAME_SIZE - 4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('arg0', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(FRAME_SIZE - 4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('arg1', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(FRAME_SIZE).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('arg2', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(FRAME_SIZE + 4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('arg3', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(FRAME_SIZE + 8).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('local0', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(-4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
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
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('store-local0', function(asm) {
    asm.pop(VM.CPU.REGISTERS.R0).
        store(VM.CPU.REGISTERS.R0, 0, FP_REG).uint32(-4).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('drop-frame', function(asm) {
    asm.
        inc(VM.CPU.REGISTERS.SP).uint32(FRAME_SIZE).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('dpush', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        inc(HEAP_REG).uint32(4).
        store(VM.CPU.REGISTERS.R0, 0, HEAP_REG).uint32(0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('dpop', function(asm) {
    asm.
        load(VM.CPU.REGISTERS.R0, 0, HEAP_REG).uint32(0).
        dec(HEAP_REG).uint32(4).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });

  defop('ddrop', function(asm) {
    asm.
        dec(HEAP_REG).uint32(4).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });

  defop('dmove', function(asm) {
    asm.pop(HEAP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('dhere', function(asm) {
    asm.
        push(HEAP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('current-frame', function(asm) {
    asm.
        push(FP_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('dict', function(asm) {
    asm.
        push(DICT_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('set-dict', function(asm) {
    asm.
        pop(DICT_REG).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });

  defop('not', function(asm) {
    asm.pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.INS).uint32(0).
        cmpi(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.R1, VM.CPU.STATUS.ZERO, VM.CPU.REGISTERS.INS).uint32(1).
        push(VM.CPU.REGISTERS.R1).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('lognot', function(asm) {
    asm.
        pop(VM.CPU.REGISTERS.R0).
        not(VM.CPU.REGISTERS.R0, VM.CPU.REGISTERS.R0).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });

  defop('doop', function(asm) {
    asm.load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(0).
        push(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).uint32(0x1234).
        push(VM.CPU.REGISTERS.R0).
        cie().
        halt().
        sie().
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  deffn('bootstrap', function(asm) {
    asm.
        //uint32('begin').
        uint32('literal').uint32(HELO).
        uint32('write-word').
        uint32('dict-init').
        uint32('bootstrap-loop').
        //uint32('end').
        uint32('quit').
        uint32('exit');
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
  
  deffn('write-ok', function(asm) {
    asm.
        uint32('literal').uint32(OK1).
        uint32('write-word').
        uint32('return0');
  });
  deffn('write-err', function(asm) {
    asm.
        uint32('literal').uint32(ERR1).
        uint32('write-word').
        uint32('return0');
  });

  deffn('lit', function(asm) {
    asm.uint32('read-token').uint32('return1');
  });
  
  deffn('bootstrap-loop', function(asm) {
    asm.label('bootstrap-loop-inner').
        uint32('write-ok').
        uint32('literal').uint32(OK2).
        uint32('write-word').
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
        uint32('call-indirect').
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
        uint32('set-dict').
        uint32('return0');
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

  deffn('dict-each', function(asm) {
    asm.
        uint32('arg0').
        label('dict-each-loop').
        uint32('terminator?').
        uint32('literal').uint32('dict-each-done').
        uint32('ifthenjump').
        uint32('arg1').
        uint32('call-op').
        uint32('swap').uint32('drop').
        uint32('dict-entry-next').
        uint32('literal').uint32('dict-each-loop').
        uint32('jump');
    asm.label('dict-each-done').
        uint32('return0');
  });
  
  defop('rot', function(asm) {
    // a b c -> c a b
    asm.load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(0).
        load(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.SP).uint32(8).
        store(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.SP).uint32(8).
        store(VM.CPU.REGISTERS.R1, 0, VM.CPU.REGISTERS.SP).uint32(0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });

  defop('call-indirect', function(asm) {
    asm.pop(VM.CPU.REGISTERS.R0).
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.R0).uint32(4);
  });

  deffn('dict-call', function(asm) {
    asm.uint32('arg1').
        uint32('arg0').
        uint32('dict-lookup').
        uint32('dup').
        uint32('literal').uint32('dict-call-go').
        uint32('ifthenjump').
        uint32('arg1').
        uint32('return1').
        label('dict-call-go').
        // todo drop the args
        uint32('literal').uint32('call-indirect').
        uint32('tailcall-op');
  });
  
  deffn('dict-init', function(asm) {
    asm.
        uint32('literal').uint32('dictionary').
        uint32('peek').
        uint32('set-dict').
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
  deffn('parent-frame', function(asm) {
    asm.
        uint32('current-frame').
        uint32('peek').
        uint32('peek'). // of the caller's caller
        uint32('return1');
  });
  deffn('set-arg0', function(asm) {
    asm.
        uint32('parent-frame').
        uint32('literal').uint32(FRAME_SIZE - 4).
        uint32('int-add').
        uint32('arg0').
        uint32('poke').
        uint32('return-1');
  });
  deffn('set-arg1', function(asm) {
    asm.
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
  //     uint32('call').
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
        //uint32('call').
        //uint32('literal').uint32('swapdrop').
        //uint32('call').
        uint32('or').
        uint32('swap').uint32('drop').uint32('swap').uint32('drop').
        //uint32('literal').uint32('swapdrop').
        //uint32('call').
        //uint32('literal').uint32('swapdrop').
        //uint32('call').
        uint32('or').
        uint32('swap').uint32('drop').uint32('swap').uint32('drop').
        //uint32('literal').uint32('swapdrop').
        //uint32('call').
        //uint32('literal').uint32('swapdrop').
        //uint32('call').
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
        uint32('call-op'). // seq head result
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
        uint32('call-op'). // seq token0 result
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
  
  deffn('compile-string', function(asm) {
    asm.uint32('arg0').
        uint32('literal').uint32('immediate-lookup').
        uint32('each-token').
        uint32('return1');
  });

  deffn('compile-string1', function(asm) {
    asm.uint32('arg0').
        uint32('tokenize').
        uint32('literal').uint32('immediate-lookup').
        uint32('map-seq').
        uint32('return1');
  });
  
  deffn('write-line', function(asm) {
    asm.uint32('arg0').
        uint32('write-string').
        uint32('literal').uint32(CRNL).
        uint32('write-word').
        uint32('return0');
  });

  deffn('write-line-ret', function(asm) {
    asm.uint32('arg0').
        uint32('write-string').
        uint32('literal').uint32(CRNL).
        uint32('write-word').
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
    // load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('call').
    asm.uint32('literal').nop().load(VM.CPU.REGISTERS.R0, 0, VM.CPU.REGISTERS.INS).
        uint32('dpush').
        uint32('dhere').
        uint32('cell+2').
        uint32('cell+2').
        uint32('dpush').
        uint32('literal').push(VM.CPU.REGISTERS.R0).load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).
        uint32('dpush').
        uint32('literal').uint32('call').
        uint32('dpush').
        uint32('return0');
  });
  
  deffn('constant-capturer', function(asm) {
    asm.uint32('start-seq').
        uint32('emit-call-param').
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
        uint32('arg1').
        uint32('constant-capturer').
        uint32('swap').uint32('drop').
        uint32('arg1').
        uint32('add-dict').
        uint32('return0');
  });

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
  
  deffn('defvar', function(asm) {
    // value name
    asm.uint32('arg0').
        uint32('variable-peeker').
        uint32('arg0').
        uint32('swap').
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

  deffn('args1', function(asm) {
    asm.uint32('args').
        uint32('cell+').
        uint32('return1');
  });
  
  deffn('local-ref', function(asm) {
    // the-location name => entry
    asm.uint32('args').
        uint32('cell+').
        uint32('peeker').
        uint32('arg0').
        uint32('swap').
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
  
  asm.label('the-tokenizer-sym').bytes(cellpad('*tokenizer*'));

  deffn('*tokenizer*', function(asm) {
    asm.uint32('literal').uint32('the-tokenizer-sym').
        uint32('dict').
        uint32('dict-lookup').
        uint32('return1');
  });
  
  deffn('e-lit', function(asm) {
    asm. // get tokenizer
        uint32('*tokenizer*').
        uint32('dup').
        uint32('call-indirect'). // tokenizer
        // read a token
        uint32('next-token'). // tokenizer new-tokenizer token
        uint32('rot'). // token new-tokenizer tokenizer
        uint32('drop'). // token new-tokenizer
        // update *tokenizer*
        uint32('local0').
        uint32('store-local-ref').
        // make a return
        uint32('drop'). // token tokenizer local
        uint32('drop'). // token
        uint32('return1');
  });
  
  deffn('eval-string', function(asm) {
    // str
    asm.uint32('arg0').
        uint32('make-tokenizer').
        uint32('swap').uint32('drop'). // tokenizer
        uint32('literal').uint32('the-tokenizer-sym').
        uint32('local-ref').
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
        uint32('call-indirect'). // expecting no return
        uint32('literal').uint32('eval-string-inner').
        uint32('jump');
    asm.label('eval-string-not-found'). // token lookup
        uint32('drop'). // token
        uint32('literal').uint32('eval-string-inner').
        uint32('jump');
    asm.label('eval-string-done'). // token
        uint32('return0');
  });

  defop('input-flush', function(asm) {
    asm.call(0, VM.CPU.REGISTERS.CS).uint32('input_flush').
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
  });
  
  defop('input-reset', function(asm) {
    asm.call(0, VM.CPU.REGISTERS.CS).uint32('reset_input').
        load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
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

  asm.label('program-size');

  asm.label('symbols-begin');

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
    
    asm.label(label_def).
        uint32(label + '-sym').
        uint32(code).
        uint32(data).
        uint32(last_label);
    
    return label_def;
  }

  function dict_entry_op(label, last_label) {
    return dict_entry(label, label, 0, last_label);
  }

  function dict_entry_fn(label, last_label) {
    return dict_entry(label, label, 0, last_label);
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

  asm.label('dictionary-end');
  asm.label('dictionary').
      uint32(last_label);
  asm.label('dictionary-size').uint32(asm.resolve('dictionary-end') - asm.resolve('dictionary-begin'));

  asm.label('toklit-sym').bytes(cellpad('lit'));
  asm.label('toklit').
      halt().
      load(VM.CPU.REGISTERS.IP, 0, VM.CPU.REGISTERS.INS).uint32('next');
      
  asm.label('tok-write-sym').bytes(cellpad('.'));
      
  last_label = TERMINATOR;
  last_label = dict_entry('toklit', 'toklit', 0, last_label);
  last_label = dict_entry('tok-write', 'write-line', 0, last_label);
  
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
