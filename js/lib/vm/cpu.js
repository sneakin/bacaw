"use strict";

if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
    VM = {};
}

const util = require('util.js');
require('vm/types.js');
const PagedHash = require('paged_hash.js');
const RangedHash = require('vm/ranged_hash.js');
const DispatchTable = require('vm/dispatch_table.js');
const assert = require('asserts.js');

VM.CPU = function(mmu, stack_start, max_cycles)
{
    this.name = "CPU";
    this.stack_start = stack_start || (1<<16);
    this.mmu = mmu;
	this._reg = new Uint32Array(VM.CPU.REGISTER_COUNT);
    this._reg_view = new DataView(this._reg.buffer);
    this.cycles = 0;
    this._pending_interrupts = [];
    this.keep_running = false;
    this.halted = false;
    this.stepping = false;
    this.running = false;
    this.max_cycles = max_cycles;
	this.reset();
}

VM.CPU.STATUS = {
    NONE: 0,
	ZERO: 1<<0,
	NEGATIVE: 1<<1,
    CARRY: 1<<2,
    ERROR: 1<<3,
	INT_ENABLED: 1<<4,
  	SLEEP: 1<<5,
    INT_FLAG: 1<<6
};
VM.CPU.STATUS.NUMERICS = VM.CPU.STATUS.ZERO | VM.CPU.STATUS.NEGATIVE | VM.CPU.STATUS.CARRY | VM.CPU.STATUS.ERROR;

VM.CPU.REGISTER_SIZE = Uint32Array.BYTES_PER_ELEMENT;
VM.CPU.INSTRUCTION_SIZE = Uint16Array.BYTES_PER_ELEMENT;

VM.CPU.REGISTER_COUNT = 16;
var REGISTERS = {
	INS: VM.CPU.REGISTER_COUNT - 1,
	STATUS: VM.CPU.REGISTER_COUNT - 2,
    ISR: VM.CPU.REGISTER_COUNT - 3,
	IP: VM.CPU.REGISTER_COUNT - 4,
	SP: VM.CPU.REGISTER_COUNT - 5,
    GP_COUNT: VM.CPU.REGISTER_COUNT - 5,
    CS: VM.CPU.REGISTER_COUNT - 6,
    DS: VM.CPU.REGISTER_COUNT - 7,
    CARRY: 1,
    ACCUM: 0
};
for(var i = 0; i < VM.CPU.REGISTER_COUNT; i++) {
    REGISTERS["R" + i] = i;
}

VM.CPU.REGISTER_NAMES = {};
for(var i in REGISTERS) {
    var number = REGISTERS[i];
    if(VM.CPU.REGISTER_NAMES[number] && (i.match(/^R\d+/) || i.match(/_COUNT/))) continue;
    VM.CPU.REGISTER_NAMES[number] = i;
}

VM.CPU.REGISTERS = REGISTERS;
VM.CPU.REGISTER_PARAMS = VM.CPU.REGISTERS.STATUS;

VM.CPU.INTERRUPTS = {
    reset: 0,
    brk: 1,
    exception: 2,
    unknown_op: 3,
    divide_by_zero: 4,
    mem_fault: 5,
    mem_access: 6,
    memset_done: 7,
    memcpy_done: 8,
    user: 9,
    max: 128
};
for(var i in VM.CPU.INTERRUPTS) {
    var n = VM.CPU.INTERRUPTS[i];
    VM.CPU.INTERRUPTS[n] = i;
}
VM.CPU.INTERRUPTS.ISR_BYTE_SIZE = VM.CPU.REGISTER_SIZE * 2;
VM.CPU.INTERRUPTS.ISR_TOTAL_SIZE = VM.CPU.INTERRUPTS.max * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE;

for(var i = 0; i < 256; i++) {
    VM.CPU.INTERRUPTS["irq" + i] = VM.CPU.INTERRUPTS.user + i;
}

VM.CPU.INS_BITOP_MASK = [
    [ 'x', [ 0x0F00, 8, "Register with the value to use to operate on ACCUM." ] ],
    [ 'carry_in',  [ 0xF000, 12, "Register with the value's carry in." ] ]
];
VM.CPU.INS_MOP_MASK = [
    [ 'x', [ 0x0F00, 8, "Register with the value." ] ],
    [ 'carry_in', [ 0xF000, 12, "Register with the value's carry in." ] ],
    [ 'type', [ 0x0004, 2, "Flags if the values are integers or floats." ] ],
    [ 'unsigned', [ 0x0001, 0, "Flags if the values are signed or unsigned integers." ] ]
];

function binary_op_type(ins, unsig)
{
    var i;
    if(typeof(ins) == 'number') {
        i = (ins & 0x4) >> 2;
        unsig = (ins & 0x1) || unsig;
    } else {
        i = ins.type;
        unsig = ins.unsigned || unsig;
    }
    return i == 1 ? VM.TYPES.FLOAT : (unsig ? VM.TYPES.ULONG : VM.TYPES.LONG);
}

function binary_op_inner(vm, ins, f, status_updater) {
    var type = binary_op_type(ins);
    var a = vm.regread(REGISTERS.ACCUM, type);
    var x = vm.regread(ins.x, type);
    var carry = vm.regread(ins.carry_in, type);
    if(ins.carry_in == VM.CPU.REGISTERS.STATUS) {
        carry = carry & VM.CPU.STATUS.CARRY;
    }
    var result = f(a, x, carry);
    vm.regwrite(REGISTERS.ACCUM, result, type);
    
    vm.clear_status(VM.CPU.STATUS.NUMERICS);
    if(status_updater) {
        var new_status = status_updater(type, result, a, x, carry);
        vm.set_status(new_status);
    }
}

function binary_op(f, status_updater)
{
    return function(vm, ins) {
        return binary_op_inner(vm, ins, f, status_updater);
    };
}

function math_ops(suffix)
{
    return [
        [ "CMP" + suffix, "Compares X and Y and sets the status bits. Zero for when X and Y are equal, Negative if X < Y and they're signed integers, Carry if X < Y for unsigned integers. Both Negative and Carry get set when comparing floats. When X or Y is the INS register, zero is used for that value.",
          [ [ 'x', [ 0x0000F00, 8, "Register with the first value." ] ],
            [ 'y',  [ 0x0000F000, 12, "Register with the second value." ] ],
            [ 'type',  [ 0x4, 2, "The data type the registers contain." ] ]
          ],
          function(vm, ins) {
              var type = binary_op_type(ins);
              var a = 0;
              if(ins.x != VM.CPU.REGISTERS.INS) {
                  a = vm.regread(ins.x, type);
              }
              var b = 0;
              if(ins.y != VM.CPU.REGISTERS.INS) {
                  b = vm.regread(ins.y, type);
              }
              var s = vm.regread(REGISTERS.STATUS);
              if(a == b || (type == VM.TYPES.FLOAT && isNaN(a) && isNaN(b))) {
                  s = s | VM.CPU.STATUS.ZERO;
              } else {
                  s = s & ~VM.CPU.STATUS.ZERO;
              }

              if(a < b) {
                  s = s | VM.CPU.STATUS.NEGATIVE;
                  if(type == VM.TYPES.FLOAT) {
                      s = s | VM.CPU.STATUS.CARRY;
                  }                      
              } else {
                  s = s & ~VM.CPU.STATUS.NEGATIVE;
                  if(type == VM.TYPES.FLOAT) {
                      s = s & ~VM.CPU.STATUS.CARRY;
                  }                      
              }

              if(type == VM.TYPES.ULONG || type == VM.TYPES.LONG) {
                  var signed_a = 0;
                  if(ins.x != VM.CPU.REGISTERS.INS) {
                      signed_a = vm.regread(ins.x, VM.TYPES.ULONG);
                  }
                  var signed_b = 0;
                  if(ins.y != VM.CPU.REGISTERS.INS) {
                      signed_b = vm.regread(ins.y, VM.TYPES.ULONG);
                  }

                  if(signed_a < signed_b) {
                      s = s | VM.CPU.STATUS.CARRY;
                  } else {
                      s = s & ~VM.CPU.STATUS.CARRY;
                  }
              } else if(type == VM.TYPES.FLOAT) {
                  if(isNaN(a) || isNaN(b)) {
                      s = s | VM.CPU.STATUS.ERROR;
                  } else {
                      s = s & ~VM.CPU.STATUS.ERROR;
                  }
              }

			  vm.regwrite(REGISTERS.STATUS, s);
          },
          [
              // unsigned
              function(vm, ins) {
                  if(ins != VM.CPU.INS.CMPI) return;
                  
	              // cmp: equal
	              vm.regwrite(2, 123);
	              vm.regwrite(1, 123);
	              vm.memwritel(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ZERO, 'sets the zero status flag');

                  // cmp: less than
	              vm.reset();
	              vm.regwrite(2, 123);
	              vm.regwrite(1, 12);
	              vm.memwrite(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY, 'sets the carry status flag');

                  // cmp: greater than
	              vm.reset();
	              vm.regwrite(1, 123);
	              vm.regwrite(2, 12);
	              vm.memwrite(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.equal(vm.regread(REGISTERS.STATUS) & (VM.CPU.STATUS.CARRY|VM.CPU.STATUS.ZERO), 0, 'sets no flags');

                  // cmp: int & INS
	              vm.reset();
	              vm.regwrite(1, 0);
	              vm.memwrite(0, vm.encode({op: ins, x: 1, y: VM.CPU.REGISTERS.INS}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ZERO, 'sets zero flag since 0 == 0');

	              vm.reset();
	              vm.regwrite(1, 0);
	              vm.memwrite(0, vm.encode({op: ins, x: VM.CPU.REGISTERS.INS, y: 1}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ZERO, 'sets zero flag since 0 == 0');
              },
              // signed
              function(vm, ins) {
                  if(ins != VM.CPU.INS.CMPI) return;
                  
	              // cmp: equal
	              vm.regwrite(2, -123);
	              vm.regwrite(1, -123);
	              vm.memwritel(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ZERO, 'sets the zero status flag');

                  // cmp: less than
	              vm.reset();
	              vm.regwrite(1, -123);
	              vm.regwrite(2, 12);
	              vm.memwrite(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.NEGATIVE, 'sets the negative status flag');

                  // cmp: greater than
	              vm.reset();
	              vm.regwrite(1, 123);
	              vm.regwrite(2, -12);
	              vm.memwrite(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.equal(vm.regread(REGISTERS.STATUS) & (VM.CPU.STATUS.NEGATIVE|VM.CPU.STATUS.ZERO), 0, 'sets no status flag');
              },
              // floats
              function(vm, ins) {
                  if(ins != VM.CPU.INS.CMPF) return;
                  
	              // cmp: equal
	              vm.regwritef(2, 123.45);
	              vm.regwritef(1, 123.45);
	              vm.memwritel(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ZERO, 'sets the zero status flag');

                  // cmp: less than
	              vm.reset();
	              vm.regwrite(2, 123.45);
	              vm.regwrite(1, 12.45);
	              vm.memwrite(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.assert(vm.regread(REGISTERS.STATUS) & (VM.CPU.STATUS.NEGATIVE|VM.CPU.STATUS.CARRY), 'sets the negative and carry status flags');

                  // cmp: greater than
	              vm.reset();
	              vm.regwrite(2, 12.45);
	              vm.regwrite(1, 123.45);
	              vm.memwrite(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.equal(vm.regread(REGISTERS.STATUS), 0, 'clears the flags');

	              // cmp: not equal
	              vm.regwritef(2, 123.34);
	              vm.regwritef(1, 123.44);
	              vm.memwritel(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.equal((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ZERO), 0, 'does not set the zero status flag');

	              // cmp: NaN
	              vm.regwritef(2, 123.34);
	              vm.regwritef(1, NaN);
	              vm.memwritel(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR), 'sets the error status flag');

	              vm.regwritef(1, 123.34);
	              vm.regwritef(2, NaN);
	              vm.memwritel(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR), 'sets the error status flag');

	              vm.regwritef(1, NaN);
	              vm.regwritef(2, NaN);
	              vm.memwritel(0, vm.encode({op: ins, x: 1, y: 2}));
	              vm.regwrite(REGISTERS.IP, 0);
	              vm.step();
	              assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR), 'sets the error status flag');
	              assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ZERO), 'sets the zero status flag');
              }
          ]
        ],
        [ "ADD" + suffix, "Adds X and Y storing the result in ACCUM.",
          VM.CPU.INS_MOP_MASK,
          binary_op(function(a, b, c) { return c + a + b; }, function(type, result, x, y, c) {
              //var status = vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY;
              var status = 0;
              
              if(type != VM.TYPES.FLOAT) {
                  // See: http://teaching.idallen.com/dat2343/10f/notes/040_overflow.txt
                  // and: https://brodowsky.it-sky.net/2015/04/02/how-to-recover-the-carry-bit/
                  var highbit = 1<<(VM.CPU.REGISTER_SIZE*8-1);
                  if(((result & highbit) != 0 && (x & highbit) == (y & highbit))
                     || ((result & highbit) == 0 && (x & highbit) != (y & highbit))) {
                      status = status | VM.CPU.STATUS.CARRY;
                  }

                  if(((x & highbit) == 0 && (y & highbit) == 0 && (result & highbit) != 0)
                     || ((x & highbit) != 0 && (y & highbit) != 0 && (result & highbit) == 0)) {
                      status = status | VM.CPU.STATUS.ERROR;
                  }
              } else {
                  if(Math.abs(result) == Infinity) {
                      status = status | VM.CPU.STATUS.ERROR;
                  }
              }

              if(result < 0) {
                  status = status | VM.CPU.STATUS.NEGATIVE;
              }
              
              if(result == 0) {
                  status = status | VM.CPU.STATUS.ZERO;
              }

              return status;
          }),
          [
              function(vm, ins) {
                  if(ins != VM.CPU.INS.ADDI) return;

                  for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg, carry_in: VM.CPU.REGISTERS.STATUS}));
                      vm.regwrite(reg, 0x3);
                      vm.regwrite(REGISTERS.ACCUM, 0x2);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM) == 0x5, "R0 has 2+3 stored in it " + vm.regread(REGISTERS.ACCUM) + " " + reg);
                      assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");

                      // unsigned carry
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg, carry_in: VM.CPU.REGISTERS.STATUS}));
                      vm.regwrite(reg, 0x2);
                      vm.regwrite(REGISTERS.ACCUM, 0xFFFFFFFF);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM) == 0x1, "R0 is incremented by 2 " + vm.regread(REGISTERS.ACCUM));
                      assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY, "sets the carry bit");

                      // signed overflow
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg, carry_in: VM.CPU.REGISTERS.STATUS}));
                      vm.regwrite(reg, -0x7FFFFFFF);
                      vm.regwrite(REGISTERS.ACCUM, -0x7FFFFFFF);
                      vm.step();
                      assert.equal(vm.regread(REGISTERS.ACCUM, VM.TYPES.LONG), 2, "R0 is incremented by -0x7FFFFFFF " + vm.regread(REGISTERS.ACCUM, VM.TYPES.LONG).toString(16));
                      assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR, "sets the error bit");
                      //assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY, "sets the carry bit");

                      // signed carry
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg, carry_in: VM.CPU.REGISTERS.STATUS}));
                      vm.regwrite(reg, 0x4);
                      vm.regwrite(REGISTERS.ACCUM, 0x7FFFFFFF);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM, VM.TYPES.LONG) == -(0x7FFFFFFF - 2), "R0 is incremented by 4 " + vm.regread(REGISTERS.ACCUM, VM.TYPES.LONG));
                      assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR, "sets the error bit");
                      //assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY, "sets the carry bit");
                  }
              },
              function(vm, ins) {
                  if(ins != VM.CPU.INS.ADDF) return;
                  
                  for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                      // floats
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg, carry_in: VM.CPU.REGISTERS.STATUS}));
                      vm.regwrite(REGISTERS.ACCUM, 2.2, VM.TYPE_IDS.FLOAT);
                      vm.regwrite(reg, 3.3, VM.TYPE_IDS.FLOAT);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM, VM.TYPE_IDS.FLOAT) == 5.5, "R0 has 2.2+3.3 stored in it " + vm.regreadf(reg));
                      assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");
                  }
              }              
          ]
        ],
        [ "MUL" + suffix, "Multiplies X and Y storing the result into ACCUM.",
          VM.CPU.INS_MOP_MASK,
          binary_op(function(a, b) { return a * b; }, function(type, result, x, y, carry) {
              var status = 0;

              if(result > type.max) {
                  status = status | VM.CPU.STATUS.ERROR;
              } else if(result < type.min) {
                  status = status | VM.CPU.STATUS.ERROR | VM.CPU.STATUS.NEGATIVE;
              }
              return status;
          }),
          [
              function(vm, ins) {
                  if(ins != VM.CPU.INS.MULI) return;

                  for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0x2);
                      vm.regwrite(reg, 0x3);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM) == 6, "R0 has 2*3 stored in it " + vm.regread(REGISTERS.ACCUM));
                      assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");

                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0x80000000);
                      vm.regwrite(reg, 0x2);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM) == 0x0, "R0 is multiplied by 2 and overflown: " + vm.regread(REGISTERS.ACCUM));
                      assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR, "sets the error bit");
                  }
              },
              function(vm, ins) {
                  if(ins != VM.CPU.INS.MULF) return;

                  for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwritef(REGISTERS.ACCUM, 2.2);
                      vm.regwritef(reg, 3.3);
                      vm.step();
                      assert.assert(Math.abs(vm.regreadf(REGISTERS.ACCUM) - 2.2*3.3) < 0.0001, "R0 has 2.2*3.3 stored in it");
                      assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");

                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwritef(REGISTERS.ACCUM, VM.TYPES.FLOAT.max);
                      vm.regwritef(reg, VM.TYPES.FLOAT.max);
                      vm.step();
                      assert.assert(vm.regreadf(REGISTERS.ACCUM) == Infinity, "R0 is multiplied by itself and overflown to infinity: " + vm.regread(REGISTERS.ACCUM));
                      assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR, "sets the error bit");
                  }
              }              
          ]
        ],
        [],
        [ "POW" + suffix, "Exponentiate X by Y.",
          VM.CPU.INS_MOP_MASK,
          binary_op(function(a, b) { return Math.pow(a, b); }, function(type, result, x, y, carry) {
              var status = 0;
              if(result > type.max || result < type.min) {
                  status = status | VM.CPU.STATUS.ERROR;
              }
              return status;
          }),
          function(vm, ins) {
              var type = binary_op_type(ins);
              
              for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                  vm.reset();
                  vm.memwritel(0, vm.encode({op: ins, x: reg}));
                  vm.regwrite(REGISTERS.ACCUM, 0x2, type);
                  vm.regwrite(reg, 0x3, type);
                  vm.step();
                  assert.assert(vm.regread(REGISTERS.ACCUM, type) == 8, "R0 has 2**3 stored in it " + vm.regread(REGISTERS.ACCUM, type));
                  assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");

                  vm.reset();
                  vm.memwritel(0, vm.encode({op: ins, x: reg}));
                  vm.regwrite(REGISTERS.ACCUM, 0x8000000, type);
                  vm.regwrite(reg, 0x2, type);
                  vm.step();
                  if(type == VM.TYPES.LONG || type == VM.TYPES.ULONG) {
                      assert.assert(vm.regread(REGISTERS.ACCUM, type) == Math.pow(0x8000000, 2) % (0xFFFFFFFF + 1), "R0 is squared and overflown " + vm.regread(REGISTERS.ACCUM, type));
                      assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR, "sets the error bit");
                  } else if(type == VM.TYPES.FLOAT) {
                      assert.assert(vm.regread(REGISTERS.ACCUM, type) == Math.pow(0x8000000, 2), "R0 is squared " + vm.regread(REGISTERS.ACCUM, type));
                  }
              }
          }
        ],
        [ "FFS" + suffix, "Finds the first one in X.",
          VM.CPU.INS_MOP_MASK,
          function(vm, ins) {
              var type = binary_op_type(ins);
              var b = vm.regread(ins.x, VM.TYPES.ULONG);

              if(type == VM.TYPES.FLOAT) {
                  vm.interrupt(VM.CPU.INTERRUPTS.unknown_op);
              } else {
                  if(b == 0) {
                      vm.regwrite(REGISTERS.ACCUM, 32, type);
                  } else {
                      // See https://en.wikipedia.org/wiki/Find_first_set
                      var n = 0;
                      if((b & 0xFFFF0000) == 0) {
                          n += 16;
                          b = b << 16;
                      }
                      if((b & 0xFF000000) == 0) {
                          n += 8;
                          b = b << 8;
                      }
                      if((b & 0xF0000000) == 0) {
                          n += 4;
                          b = b << 4;
                      }
                      if((b & 0xC0000000) == 0) {
                          n += 2;
                          b = b << 2;
                      }
                      if((b & 0x80000000) == 0) {
                          n += 1;
                      }

                      vm.regwrite(REGISTERS.ACCUM, n, VM.TYPES.ULONG);
                  }
              }
          },
          function(vm, ins) {
              var type = binary_op_type(ins);
              
              // causes an unknown op interrupt for floats
              if(type == VM.TYPES.FLOAT) {
                  assert.equal(vm._pending_interrupts.length, 0, 'has a no pending interrupt');
                  vm._pending_interrupts = [];
                  vm.keep_running = true; // step() doesn't enable this like run()
	              vm.memwritel(0, vm.encode({op: ins, x: 1}));
	              vm.memwritel(VM.CPU.REGISTER_SIZE, vm.encode({op: VM.CPU.INS.NOP}));
	              vm.regwrite(REGISTERS.IP, 0);
                  vm.regwrite(REGISTERS.SP, 0x10);
                  vm.regwrite(REGISTERS.ISR, 0x100);
                  vm.enable_interrupts();
	              vm.step();
	              vm.step();

                  assert.assert(vm.regread(REGISTERS.SP) == 0x10 - 8, 'pushed IP: ' + vm.memreadl(vm.regread(REGISTERS.SP)));
                  assert.assert(vm.regread(REGISTERS.IP) == 0x100 + VM.CPU.INTERRUPTS.unknown_op * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE, 'sets IP to 0x100 + 12*ISR_BYTE_SIZE: ' + vm.regread(REGISTERS.IP).toString(16));
              } else {
                  for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0x2, type);
                      vm.regwrite(reg, 0x0, type);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM, type) == 32, "R0 has number of leading zeros in 0 " + vm.regread(REGISTERS.ACCUM, type));

                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0x2, type);
                      vm.regwrite(reg, 0x3, type);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM, type) == 30, "R0 has number of leading zeros in 0x3 " + vm.regread(REGISTERS.ACCUM, type));

                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0x2, type);
                      vm.regwrite(reg, 0x8000000, type);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM, type) == 4, "R0 has the number of leading zeros in 0x80000000 " + vm.regread(REGISTERS.ACCUM, type));

                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0x2, type);
                      vm.regwrite(reg, 0xFFFFFFFF, type);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM, type) == 0, "R0 has the number of leading zeros in 0xFFFFFFFF " + vm.regread(REGISTERS.ACCUM, type));
                  }
              }
          }
        ],
        [ "CEIL", "Round Y up to the nearest integer and store it in X.",
          [ [ 'src', [ 0xF00, 8 ] ],
            [ 'dest', [ 0xF000, 12  ] ]
          ],
          function(vm, ins) {
              vm.regwrite(ins.dest, Math.ceil(vm.regread(ins.src, VM.TYPES.FLOAT)), VM.TYPES.FLOAT);
          },
          function(vm, ins) {
              vm.memwritel(0, vm.encode({op: ins, src: 1, dest: 2}));
              vm.regwrite(1, 1234.56, VM.TYPES.FLOAT);
              vm.regwrite(2, 0x80);
              vm.step();
              assert.equal(vm.regread(2, VM.TYPES.FLOAT), 1235, 'has no decimal');

              vm.regwrite(REGISTERS.IP, 0);
              vm.regwrite(1, -1234.56, VM.TYPES.FLOAT);
              vm.regwrite(2, 0x80);
              vm.step();
              assert.equal(vm.regread(2, VM.TYPES.FLOAT), -1234, 'has no decimal');
          }
        ],
        [ "ROUND", "Round Y to the nearest integer and store it in X.",
          [ [ 'src', [ 0xF00, 8 ] ],
            [ 'dest', [ 0xF000, 12  ] ]
          ],
          function(vm, ins) {
              vm.regwrite(ins.dest, Math.round(vm.regread(ins.src, VM.TYPES.FLOAT)), VM.TYPES.FLOAT);
          },
          function(vm, ins) {
              vm.memwritel(0, vm.encode({op: ins, src: 1, dest: 2}));
              vm.regwrite(1, 1234.56, VM.TYPES.FLOAT);
              vm.regwrite(2, 0x80);
              vm.step();
              assert.equal(vm.regread(2, VM.TYPES.FLOAT), 1235, 'rounds up');

              vm.regwrite(REGISTERS.IP, 0);
              vm.regwrite(1, -1234.56, VM.TYPES.FLOAT);
              vm.regwrite(2, 0x80);
              vm.step();
              assert.equal(vm.regread(2, VM.TYPES.FLOAT), -1235, 'rounds negatives down');

              vm.regwrite(REGISTERS.IP, 0);
              vm.regwrite(1, -1234.36, VM.TYPES.FLOAT);
              vm.regwrite(2, 0x80);
              vm.step();
              assert.equal(vm.regread(2, VM.TYPES.FLOAT), -1234, 'rounds down');
          }
        ],
        [ "MOD" + suffix, "Take the modulus of X by Y.",
          VM.CPU.INS_MOP_MASK,
          function(vm, ins) {
              var denom = vm.regread(ins.x);
              var type = binary_op_type(ins);

              if(denom > 0 || type == VM.TYPES.FLOAT) {
                  binary_op_inner(vm, ins, function(a, b) { return a % b; });
                  vm.clear_status(VM.CPU.STATUS.ERROR);
              } else {
                  vm.set_status(VM.CPU.STATUS.ERROR);
              }
          },
          [
              function(vm, ins) {
                  if(ins != VM.CPU.INS.MODI) return;
                  
                  for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0x10);
                      vm.regwrite(reg, 0x3);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM) == 1, "R0 has 10%3 stored in it " + vm.regread(REGISTERS.ACCUM));

                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0x8000);
                      vm.regwrite(reg, 0x0);
                      vm.step();
                      assert.equal(vm.regread(REGISTERS.ACCUM), 0x8000, 'left R0 untouched');
                      assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR, "sets the error bit");
                  }
              },
              function(vm, ins) {
                  if(ins != VM.CPU.INS.MODU) return;
                  
                  for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0x10);
                      vm.regwrite(reg, 0x3);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM) == 1, "R0 has 10%3 stored in it " + vm.regread(REGISTERS.ACCUM));

                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0x8000);
                      vm.regwrite(reg, 0x0);
                      vm.step();
                      assert.equal(vm.regread(REGISTERS.ACCUM), 0x8000, 'left R0 untouched');
                      assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR, "sets the error bit");

                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0xFFFF);
                      vm.regwrite(reg, 0x4);
                      vm.step();
                      assert.equal(vm.regread(REGISTERS.ACCUM), (0xFFFF % 4), 'stores 0xFFFF % 0x4 into R0');
                      assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");
                  }
              },
              function(vm, ins) {
                  if(ins != VM.CPU.INS.MODF) return;
                  
                  for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwritef(REGISTERS.ACCUM, 123.45);
                      vm.regwritef(reg, 3.3);
                      vm.step();
                      assert.assert(Math.abs(vm.regreadf(REGISTERS.ACCUM) - (123.45 % 3.3)) < 0.0001, "R0 has 123.45 % 3.3 stored in it " + vm.regreadf(REGISTERS.ACCUM));
                      assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");
                  }
              }              
          ]
        ],
        [ "SUB" + suffix, "Subtract X and Y storing the result into ACCUM.",
          VM.CPU.INS_MOP_MASK,
          binary_op(function(a, b) { return a - b; }, function(type, result, x, y, c) {
              //var status = vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY;
              var status = 0;
              
              if(type != VM.TYPES.FLOAT) {
                  if(result > type.max || result < type.min) {
                      status = status | VM.CPU.STATUS.CARRY;
                  }

                  // See: http://teaching.idallen.com/dat2343/10f/notes/040_overflow.txt
                  var highbit = 1<<(VM.CPU.REGISTER_SIZE*8-1);
                  if(((x & highbit) == 0 && (y & highbit) != 0 && (result & highbit) != 0)
                     || ((x & highbit) != 0 && (y & highbit) == 0 && (result & highbit) == 0)) {
                      status = status | VM.CPU.STATUS.ERROR;
                  }
              }

              if(result < 0) {
                  status = status | VM.CPU.STATUS.NEGATIVE;
              }
              
              if(result == 0) {
                  status = status | VM.CPU.STATUS.ZERO;
              }

              return status;
          }),
          function(vm, ins) {
              for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                  // positive
                  vm.reset();
                  vm.memwritel(0, vm.encode({op: ins, x: reg}));
                  vm.regwrite(REGISTERS.ACCUM, 0x5);
                  vm.regwrite(reg, 0x3);
                  vm.step();
                  assert.assert(vm.regread(REGISTERS.ACCUM) == 0x2, "R0 has 5-3 stored in it " + vm.regread(REGISTERS.ACCUM));
                  assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.NEGATIVE) == 0, "clears the negative bit");
                  assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ZERO) == 0, "clears the zero bit");

                  // negative
                  vm.reset();
                  vm.memwritel(0, vm.encode({op: ins, x: reg}));
                  vm.regwrite(REGISTERS.ACCUM, 0x2);
                  vm.regwrite(reg, 0x5);
                  vm.step();
                  assert.assert(toString(vm.regread(REGISTERS.ACCUM)) == toString(0xFFFFFFED), "R0 is 2 - 5 " + vm.regread(REGISTERS.ACCUM));
                  assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.NEGATIVE, "sets the negative bit");
                  assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ZERO) == 0, "clears the zero bit");

                  // zero
                  vm.reset();
                  vm.regwrite(REGISTERS.IP, 0x10);
                  vm.memwritel(0x10, vm.encode({op: ins, x: reg}));
                  vm.regwrite(REGISTERS.ACCUM, 0x5);
                  vm.regwrite(reg, 0x5);
                  vm.step();
                  assert.assert(vm.regread(REGISTERS.ACCUM) == 0, "R0 is 0 " + vm.regread(REGISTERS.ACCUM));
                  assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.NEGATIVE) == 0, "clears the negative bit");
                  assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ZERO, "sets the zero bit");
              }
          }
        ],
        [ "DIV" + suffix, "Divide X by Y storing the result into ACCUM.",
          VM.CPU.INS_MOP_MASK,
          function(vm, ins) {
              var denom = vm.regread(ins.x);
              var type = binary_op_type(ins);
              if(denom != 0 || type == VM.TYPES.FLOAT) {
                  binary_op_inner(vm, ins, function(a, b) { return a / b; });
                  vm.clear_status(VM.CPU.STATUS.ERROR);
              } else {
                  vm.set_status(VM.CPU.STATUS.ERROR);
              }
          },
          function(vm, ins) {
              var type = binary_op_type(ins);
              
              for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                  vm.reset();
                  vm.memwritel(0, vm.encode({op: ins, x: reg}));
                  vm.regwrite(REGISTERS.ACCUM, 10, type);
                  vm.regwrite(reg, 4, type);
                  vm.step();
                  var expecting = 2.5;
                  if(type != VM.TYPES.FLOAT) { expecting = 2; }
                  assert.assert(vm.regread(REGISTERS.ACCUM, type) == expecting, "R0 has int(10/4) stored in it " + vm.regread(REGISTERS.ACCUM, type));
                  assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");

                  if(type != VM.TYPES.FLOAT) {
                      // overflow test
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0x8000, type);
                      vm.regwrite(reg, 0x0, type);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM, type) == 0x8000, 'left R0 untouched');
                      assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) != 0, "sets the error bit");
                  } else if(type == VM.TYPES.ULONG) {
                      // unsigned test
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, 0xF000, type);
                      vm.regwrite(reg, 0x4, type);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM, type) == (0xF000 / 4), 'can divide unsigned numbers');
                  } else if(type == VM.TYPES.FLOAT) {
                      // negative test
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(REGISTERS.ACCUM, -10, type);
                      vm.regwrite(reg, 2, type);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM, type) == -5, 'can divide negative numbers');
                  }
              }
          }
        ],
        [ "CONV" + suffix, "Convert between floats and integers.",
          [ [ 'reg', [ 0xF00, 8 ] ],
            [ 'type_out', [ 0xF000, 12 ] ],
            [ 'type', [ 0x4, 2 ] ]
          ],
          function(vm, ins) {
              var type_out = VM.TYPES[ins.type_out];
              var type_in = binary_op_type(ins);
              if(type_in != VM.TYPES.FLOAT && ins.unsigned == 0) {
                  type_in = VM.TYPES.LONG;
              }

              var v = vm.regread(ins.reg, type_in);
              var status = 0;
              if(v > type_out.max) {
                  status = status | VM.CPU.STATUS.ERROR;
              } else if(v < type_out.min) {
                  status = status | VM.CPU.STATUS.ERROR | VM.CPU.STATUS.NEGATIVE;
              } else {
                  vm.regwrite(ins.reg, v, type_out);
              }

              vm.set_status(status);
          },
          [
              // from integers
              function(vm, ins) {
                  if(ins != VM.CPU.INS.CONVI) return;

                  // unsigned
                  vm.memwritel(0, vm.encode({op: ins, reg: 1, type_out: VM.TYPE_IDS.FLOAT, unsigned: 1}));
                  vm.regwrite(1, 1234);
                  vm.step();
                  assert.not_equal(vm.regread(1, VM.TYPES.ULONG), 1234, 'no longer a ulong');
                  assert.equal(vm.regread(1, VM.TYPES.FLOAT), 1234.0, 'converts to a float');

                  // signed
                  vm.reset();
                  vm.memwritel(0, vm.encode({op: ins, reg: 1, type_out: VM.TYPE_IDS.FLOAT, unsigned: 0}));
                  vm.regwrite(1, -1234);
                  vm.step();
                  assert.not_equal(vm.regread(1, VM.TYPES.ULONG), -1234, 'no longer a long');
                  assert.equal(vm.regread(1, VM.TYPES.FLOAT), -1234.0, 'converts to a float');
              },
              // from floats
              function(vm, ins) {
                  if(ins != VM.CPU.INS.CONVF) return;
                  
                  // to signed
                  vm.memwritel(0, vm.encode({op: ins, reg: 1, type_out: VM.TYPE_IDS.LONG, unsigned: 0}));
                  vm.regwritef(1, -1234.45);
                  vm.step();
                  assert.not_equal(vm.regread(1, VM.TYPES.FLOAT), -1234.45, 'no longer a float');
                  assert.equal(vm.regread(1, VM.TYPES.LONG), -1234, 'no longer a float');

                  // to unsigned
                  vm.reset();
                  vm.memwritel(0, vm.encode({op: ins, reg: 1, type_out: VM.TYPE_IDS.ULONG, unsigned: 1}));
                  vm.regwritef(1, -1234.45);
                  vm.step();
                  assert.assert(Math.abs(vm.regread(1, VM.TYPES.FLOAT) - -1234.45) < 0.001, 'stays the same');
                  assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) != 0, 'sets the error bit');
              },
          ]
        ],
        [ "ROOT" + suffix, "Take the X root of Y and store it in DEST.",
          VM.CPU.INS_MOP_MASK,
          binary_op(function(a, b) { return Math.pow(a, (1.0 / b)); }),
          function(vm, ins) {
              var type = binary_op_type(ins);

              for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                  vm.reset();
                  vm.memwritel(0, vm.encode({op: ins, x: reg, type: type.id}));
                  vm.regwrite(REGISTERS.ACCUM, 27, type);
                  vm.regwrite(reg, 3, type);
                  vm.step();
                  assert.assert(vm.regread(REGISTERS.ACCUM, type) == 3, "R0 has 27**(1/3) stored in it " + vm.regread(REGISTERS.ACCUM, type));
                  assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");
                  // TODO: zero root
              }
          }
        ],
        [ "LOG" + suffix, "Take the base 2 logarithm of X.",
          VM.CPU.INS_MOP_MASK,
          // todo signal errors when X is <= 0
          binary_op(function(a, b) { return Math.log2(b); }),
          [
              function(vm, ins) {
                  if(ins != VM.CPU.INS.LOGI) return;
                  
                  for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwrite(reg, 123);
                      vm.step();
                      assert.assert(vm.regread(REGISTERS.ACCUM) == Math.floor(Math.log2(123)), "R0 has Math.log2(123) stored in it " + vm.regread(REGISTERS.ACCUM));
                      assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");
                  }
              },
              function(vm, ins) {
                  if(ins != VM.CPU.INS.LOGF) return;
                  
                  // floats
                  for(var reg = 1; reg < VM.CPU.REGISTERS.GP_COUNT; reg++) {
                      vm.reset();
                      vm.memwritel(0, vm.encode({op: ins, x: reg}));
                      vm.regwritef(reg, 123.45);
                      vm.step();
                      assert.assert(Math.abs(vm.regreadf(0) - Math.log2(123.45)) < 0.001, "R0 has Math.log2(123.45) stored in it " + vm.regreadf(0));
                      assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");
                  }
              }
          ]
        ],
        [ "FLOOR", "Round Y down to the nearest integer and store it in X.",
          [ [ 'src', [ 0xF00, 8 ] ],
            [ 'dest', [ 0xF000, 12  ] ]
          ],
          function(vm, ins) {
              vm.regwrite(ins.dest, Math.floor(vm.regread(ins.src, VM.TYPES.FLOAT)), VM.TYPES.FLOAT);
          },
          function(vm, ins) {
              vm.memwritel(0, vm.encode({op: ins, src: 1, dest: 2}));
              vm.regwrite(1, 1234.56, VM.TYPES.FLOAT);
              vm.regwrite(2, 0x80);
              vm.step();
              assert.equal(vm.regread(2, VM.TYPES.FLOAT), 1234, 'has no decimal');

              vm.regwrite(REGISTERS.IP, 0);
              vm.regwrite(1, -1234.56, VM.TYPES.FLOAT);
              vm.regwrite(2, 0x80);
              vm.step();
              assert.equal(vm.regread(2, VM.TYPES.FLOAT), -1235, 'has no decimal');
          }
        ],
        [],
        []
    ]
};

VM.CPU.INS_DEFS = [
    // 0x0
    [ [ "NOP", "Nothing operation does nothing.",
        [ [ 'comment', [ 0xFF00, 8 ] ]
        ],
        function(vm, ins) {
        },
        function(vm, ins) {
	        vm.memwrite(0, [ VM.CPU.INS.NOP, 0, 0, 0 ]);
	        vm.regwrite(REGISTERS.IP, 0);
	        vm.step();
	        assert.assert(vm.regread(REGISTERS.IP) == VM.CPU.INSTRUCTION_SIZE, 'ip advances');
        }
      ],
      [ "NOT", "Store the negated bits of Y into X.",
        [ [ 'x', [ 0x0F00, 8 ] ],
          [ 'y', [ 0xF000, 12  ]]
        ],
        function(vm, ins) {
            vm.regwrite(ins.x, ~vm.regread(ins.y));
        },
        function(vm, ins) {
            vm.memwrite(0, [ VM.CPU.INS.NOT, 1, 0, 0, ]);
            vm.regwrite(REGISTERS.ACCUM, 0xF0F0F0F0);
            vm.regwrite(1, 0x80);
            vm.step();
            assert.assert(vm.regread(1) == 0xF0F0F0F, "R1 is negated R0: " + vm.regread(1));
        }
      ],
      [ "OR", "Place a bitwise inclusive disjunction of X and Y into DEST.",
        VM.CPU.INS_BITOP_MASK,
        function(vm, ins) {
            vm.regwrite(REGISTERS.ACCUM, vm.regread(REGISTERS.ACCUM) | vm.regread(ins.x));
        },
        function(vm, ins) {
            vm.memwritel(0, vm.encode({op: VM.CPU.INS.OR, x: 1}));
            vm.regwrite(REGISTERS.ACCUM, 0xF0F0F0F0);
            vm.regwrite(1, 0xF);
            vm.step();
            assert.assert(vm.regread(REGISTERS.ACCUM) == 0xF0F0F0FF, "R0 is R0 OR R1: " + vm.regread(REGISTERS.ACCUM));
        }
      ],
      [ "XOR", "Place a bitwise exclusive disjunction of X and Y into DEST.",
        VM.CPU.INS_BITOP_MASK,
        function(vm, ins) {
            vm.regwrite(REGISTERS.ACCUM, vm.regread(REGISTERS.ACCUM) ^ vm.regread(ins.x));
        },
        function(vm, ins) {
            vm.memwritel(0, vm.encode({op: VM.CPU.INS.XOR, x: 1 }));
            vm.regwrite(REGISTERS.ACCUM, 0xF0F0F0F0);
            vm.regwrite(1, 0xFF);
            vm.step();
            assert.assert(vm.regread(REGISTERS.ACCUM) == 0xF0F0F00F, "R0 is R0 XOR R1: " + vm.regread(REGISTERS.ACCUM));
        }
      ],
      [ "AND", "Place a bitwise conjunction of X and Y into DEST.",
        VM.CPU.INS_BITOP_MASK,
        function(vm, ins) {
            var value = vm.regread(REGISTERS.ACCUM) & vm.regread(ins.x);
            vm.regwrite(REGISTERS.ACCUM, value);
            var status = 0;
            if(value == 0) {
                status = status | VM.CPU.STATUS.ZERO;
            }
            if(value < 0) {
                status = status | VM.CPU.STATUS.NEGATIVE;
            }
            vm.set_status(status);
        },
        function(vm, ins) {
            vm.memwritel(0, vm.encode({op: VM.CPU.INS.AND, x: 1}));
            vm.regwrite(REGISTERS.ACCUM, 0xF0F0F0F0);
            vm.regwrite(1, 0xFF);
            vm.step();
            assert.assert(vm.regread(REGISTERS.ACCUM) == 0xF0, "R0 is R0 AND R1: " + vm.regread(REGISTERS.ACCUM));

            vm.reset();
            vm.memwritel(0, vm.encode({op: VM.CPU.INS.AND, x: 1}));
            vm.regwrite(REGISTERS.ACCUM, 0xF0F0F000);
            vm.regwrite(1, 0xFF);
            vm.step();
            assert.assert(vm.regread(REGISTERS.ACCUM) == 0x0, "R0 is R0 AND R1: " + vm.regread(REGISTERS.ACCUM));
            assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ZERO) != 0, 'updates the status bits');
        }
      ],
      [ "BSL", "Shift the bits in ACCUM left by X.",
        VM.CPU.INS_BITOP_MASK,
        function(vm, ins) {
            var shift = vm.regread(ins.x);
            if(shift > 0) {
                var x = vm.regread(REGISTERS.ACCUM);
                var result = x << shift;
                if(ins.carry_in != VM.CPU.REGISTERS.STATUS) {
                    result = result | (vm.regread(ins.carry_in) >> (32 - shift));
                }
                if(x & 0x80000000) {
                    vm.set_status(VM.CPU.STATUS.CARRY);
                }
                vm.regwrite(REGISTERS.ACCUM, result & 0xFFFFFFFF);
                vm.regwrite(REGISTERS.CARRY, (x >> (32 - shift)) & 0xFFFFFFFF);
            }
        },
        function(vm, ins) {
            vm.memwritel(0, vm.encode({op: VM.CPU.INS.BSL, x: 1, carry_in: VM.CPU.REGISTERS.STATUS}));
            vm.regwrite(REGISTERS.ACCUM, 0x82345678);
            vm.regwrite(1, 8);
            vm.step();
            assert.assert(vm.regread(REGISTERS.ACCUM) == 0x34567800, "R0 is R0 << R1: " + vm.regread(REGISTERS.ACCUM));
            assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY, 'sets the carry flag');

            vm.reset();
            vm.memwritel(0, vm.encode({op: VM.CPU.INS.BSL, x: 1, carry_in: VM.CPU.REGISTERS.STATUS}));
            vm.regwrite(REGISTERS.ACCUM, 0x00345678);
            vm.regwrite(1, 8);
            vm.step();
            assert.assert(vm.regread(REGISTERS.ACCUM) == 0x34567800, "R0 is R0 << R1: " + vm.regread(REGISTERS.ACCUM));
            assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY) == 0, 'does not set the carry bit');

            vm.reset();
            vm.memwritel(0, vm.encode({op: VM.CPU.INS.BSL, x: 1, carry_in: 2}));
            vm.regwrite(REGISTERS.ACCUM, 0x12345678);
            vm.regwrite(1, 8);
            vm.regwrite(2, 0x23F0F0F0);
            vm.step();
            assert.equal(vm.regread(REGISTERS.CARRY), 0x12, "R1 has the bits shifted off");
            assert.equal(vm.regread(REGISTERS.ACCUM), 0x34567823, "R0 is R0 << R1 " + vm.regread(REGISTERS.ACCUM).toString(16));
            assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY) == 0, 'does not set the carry bit');
        }
      ],
      [],
      [ "INT", "Cause an interrupt.",
        [ [ 'x', [ 0xFF00, 8  ] ]
        ],
        function(vm, ins) {
            vm.interrupt(ins.x);
        },
        function(vm, ins) {
            assert.equal(vm._pending_interrupts.length, 0, 'has no pending interrupts');
            vm._pending_interrupts = [];
            vm.keep_running = true; // step() doesn't enable this like run()
	        vm.memwritel(0, vm.encode({op: VM.CPU.INS.INT, x: 12}));
	        vm.memwritel(VM.CPU.REGISTER_SIZE, vm.encode({op: VM.CPU.INS.NOP}));
	        vm.regwrite(REGISTERS.IP, 0);
            vm.regwrite(REGISTERS.SP, 0x10);
            vm.regwrite(REGISTERS.ISR, 0x100);
	        vm.step();
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED) == 0, 'has yet to set the INT_ENABLED status flag');
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_FLAG) == 0, 'has yet to set the INT_FLAG status flag');
            assert.assert(vm.memreadl(vm.regread(REGISTERS.SP)) != 4, 'has yet to push IP');
            assert.assert(vm.regread(REGISTERS.IP) == VM.CPU.INSTRUCTION_SIZE, 'has yet to change IP');

            // interrupts are disabled, so nothing happens
            vm.step();
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED) == 0, 'interrupts disabled');
            assert.equal(vm._pending_interrupts.length, 0, 'is not pending');
            assert.assert(vm.regread(REGISTERS.SP) == 0x10, 'did not push IP: ' + vm.memreadl(vm.regread(REGISTERS.SP)));

            // enable interrupts
            vm.enable_interrupts();
	        vm.regwrite(REGISTERS.IP, 0);
            vm.step();
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED) != 0, 'interrupts enabled');
            assert.equal(vm._pending_interrupts.length, 1, 'is pending');

            vm.step();
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED) == 0, 'disables interrupts');
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_FLAG) != 0, 'sets interrupt flag');
            assert.assert(vm.regread(REGISTERS.SP) == 0x10 - 8, 'pushed IP: ' + vm.memreadl(vm.regread(REGISTERS.SP)));
            assert.assert(vm.regread(REGISTERS.IP) == 0x100 + 12 * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE, 'sets IP to 0x100 + 12*ISR_BYTE_SIZE: ' + vm.regread(REGISTERS.IP).toString(16));
            assert.equal(vm._pending_interrupts.length, 0, 'is no longer pending');
        }
      ],
      [ "HALT", "Halts the CPU.", [],
        function(vm, ins) {
            vm.halted = true;
            return true;
        },
        function(vm, ins) {
            vm.memwritel(0, vm.encode({op: ins}));
            assert.equal(vm.step(), false, 'causes step to return false');
        }
      ],
      [ "NEG", "Convert REG's value to a negative and store it in ACCUM taking TYPE into account.",
        { reg: [ 0x00000F00, 8 ],
          type: [ 0xF000, 12 ]
        },
        function(vm, ins) {
            vm.regwrite(VM.CPU.REGISTERS.ACCUM, -vm.regread(ins.reg, ins.type), ins.type);
        },
        [
            function(vm, ins) {
                // integer value
                vm.memwritel(0, vm.encode({op: ins, reg: 3, type: 0 }));
                vm.regwrite(3, 0xF0F0F0F0);
                vm.regwrite(0, 0x80);
                vm.step();
                assert.assert(vm.regread(REGISTERS.ACCUM) == (0xFFFFFFFF - 0xF0F0F0F0 + 1), "ACCUM is negative R3: " + vm.regread(REGISTERS.ACCUM).toString(16));
            },
            function(vm, ins) {
                // float
                vm.memwritel(0, vm.encode({op: ins, type: VM.TYPE_IDS.FLOAT, reg: 2 }));
                vm.regwritef(2, 123.45);
                vm.regwrite(0, 0x80);
                vm.step();
                assert.assert(Math.abs(vm.regreadf(REGISTERS.ACCUM) + 123.45) < 0.001, "ACCUM is negative R3: " + vm.regreadf(REGISTERS.ACCUM));
            }
        ]
      ],
      [],
      [],
      [ "RTI", "Pop STATUS and IP returning from an interrupt.", {},
        function(vm, ins) {
            var sleeping = (vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.SLEEP) != 0;
            vm.pop(REGISTERS.STATUS);
            var was_sleeping = (vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.SLEEP) != 0;
            if(!sleeping && was_sleeping) {
                vm.clear_status(VM.CPU.STATUS.SLEEP);
            }
            vm.pop(REGISTERS.IP);

            return sleeping;
        },
        [
            function(vm, ins) {
                vm.memwritel(0, vm.encode({op: ins}));
                vm.regwrite(REGISTERS.SP, 0x100);
                vm.push_value(0x30);
                vm.push_value(VM.CPU.STATUS.NEGATIVE);
                vm.step();

                assert.equal(vm.regread(REGISTERS.SP), 0x100, 'popped values from the stack');
                assert.equal(vm.regread(REGISTERS.STATUS), VM.CPU.STATUS.NEGATIVE, 'sets STATUS to the first value on the stack');
                assert.equal(vm.regread(REGISTERS.IP), 0x30, 'sets IP to second value on the stack');

                // stays in sleep
                vm.set_status(VM.CPU.STATUS.SLEEP);
                vm.regwrite(REGISTERS.IP, 0);
                vm.push_value(0x30);
                vm.push_value(VM.CPU.STATUS.NEGATIVE|VM.CPU.STATUS.SLEEP);
                vm.step();
                assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.SLEEP, 'stays sleeping');
            },
            function(vm, ins) {
                // while sleeping, toggling the sleep status causes the new value to stick after RTI
                vm.clear_status(VM.CPU.STATUS.INT_ENABLED);
                vm.set_status(VM.CPU.STATUS.SLEEP|VM.CPU.STATUS.INT_FLAG);
                vm.memwritel(0, vm.encode({op: VM.CPU.INS.LOAD, dest: VM.CPU.REGISTERS.R0 }));
                vm.memwriteL(VM.CPU.INSTRUCTION_SIZE, 0);
                vm.memwriteL(VM.CPU.INSTRUCTION_SIZE + VM.TYPES.ULONG.byte_size, vm.encode({op: VM.CPU.INS.MOVE, src: VM.CPU.REGISTERS.R0, dest: VM.CPU.REGISTERS.STATUS}));
                vm.memwritel(VM.CPU.INSTRUCTION_SIZE * 2 + VM.TYPES.ULONG.byte_size, vm.encode({op: ins}));
                vm.regwrite(REGISTERS.SP, 0x100);
                vm.push_value(0x30);
                vm.push_value(VM.CPU.STATUS.NEGATIVE|VM.CPU.STATUS.INT_ENABLED);
                vm.step();
                vm.step();
                vm.step();

                assert.equal(vm.regread(REGISTERS.SP), 0x100, 'popped values from the stack');
                assert.equal(vm.regread(REGISTERS.IP), 0x30, 'sets IP to second value on the stack');
                assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.SLEEEP) == 0, 'keeps sleep bit clear');
                assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.NEGATIVE) != 0, 'kept other bits');
                assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED) != 0, 'kept other bits');
                assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_FLAG) == 0, 'clears interrupt flag');
            }
        ]
      ],
      [ "BSR", "Shift the bits in ACCUM right by X.",
        VM.CPU.INS_BITOP_MASK,
        function(vm, ins) {
            var shift = vm.regread(ins.x);
            if(shift > 0) {
                var x = vm.regread(REGISTERS.ACCUM);
                var result = x >>> shift;
                if(ins.carry_in != VM.CPU.REGISTERS.STATUS) {
                    result = result | (vm.regread(ins.carry_in) & ((1<<shift) - 1)) << (32 - shift);
                }
                vm.regwrite(REGISTERS.ACCUM, result & 0xFFFFFFFF);
                vm.regwrite(REGISTERS.CARRY, x & ((1<<shift) - 1));
            }
        },
        function(vm) {
            vm.memwritel(0, vm.encode({op: VM.CPU.INS.BSR, x: 1, carry_in: VM.CPU.REGISTERS.STATUS }));
            vm.regwrite(REGISTERS.ACCUM, 0x12345678);
            vm.regwrite(1, 8);
            vm.step();
            assert.assert(vm.regread(REGISTERS.ACCUM) == 0x00123456, "R0 is R0 >> R1: " + vm.regread(REGISTERS.ACCUM));
            assert.equal(vm.regread(REGISTERS.CARRY), 0x78, 'carries out the bits');

            vm.reset();
            vm.memwritel(0, vm.encode({op: VM.CPU.INS.BSR, x: 1, carry_in: 2 }));
            vm.regwrite(REGISTERS.ACCUM, 0x12345678);
            vm.regwrite(1, 8);
            vm.regwrite(2, 0xFEDCBA);
            vm.step();
            assert.assert(vm.regread(REGISTERS.ACCUM) == 0xBA123456, "R0 is R0 >> R1: " + vm.regread(REGISTERS.ACCUM).toString(16));
            assert.equal(vm.regread(REGISTERS.CARRY), 0x78, 'carries out the bits');
        }
      ],
      [ "CLS", "Clear the status register's compare bits.",
        [ [ 'bits', [ 0xF00, 8 ] ] ],
        function(vm, ins) {
            vm.clear_status(ins.bits);
        },
        function(vm, ins) {
            vm.set_status(ins.bits);
            vm.memwritel(0, vm.encode({op: ins}));
            vm.step();
            assert.assert((vm.regread(REGISTERS.STATUS) & ins.bits) == 0, 'clears the bits');
        }
      ],
      [ "INTR", "Cause an interrupt with the register providing the interrupt number.",
        [ [ 'x', [ 0x0F00, 8  ] ]
        ],
        function(vm, ins) {
            vm.interrupt(vm.regread(ins.x));
        },
        function(vm, ins) {
            assert.equal(vm._pending_interrupts.length, 0, 'has no pending interrupts');
            vm._pending_interrupts = [];
            vm.keep_running = true; // step() doesn't enable this like run()
	        vm.memwritel(0, vm.encode({op: VM.CPU.INS.INTR, x: 3}));
	        vm.memwritel(VM.CPU.REGISTER_SIZE, vm.encode({op: VM.CPU.INS.NOP}));
            vm.regwrite(3, 12);
	        vm.regwrite(REGISTERS.IP, 0);
            vm.regwrite(REGISTERS.SP, 0x10);
            vm.regwrite(REGISTERS.ISR, 0x100);
	        vm.step();
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED) == 0, 'has yet to set the INT_ENABLED status flag');
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_FLAG) == 0, 'has yet to set the INT_FLAG status flag');
            assert.assert(vm.memreadl(vm.regread(REGISTERS.SP)) != 4, 'has yet to push IP');
            assert.assert(vm.regread(REGISTERS.IP) == VM.CPU.INSTRUCTION_SIZE, 'has yet to change IP');

            // interrupts are disabled, so nothing happens
            vm.step();
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED) == 0, 'interrupts disabled');
            assert.equal(vm._pending_interrupts.length, 0, 'is not pending');
            assert.assert(vm.regread(REGISTERS.SP) == 0x10, 'did not push IP: ' + vm.memreadl(vm.regread(REGISTERS.SP)));

            // enable interrupts
            vm.enable_interrupts();
	        vm.regwrite(REGISTERS.IP, 0);
            vm.step();
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED) != 0, 'interrupts enabled');
            assert.equal(vm._pending_interrupts.length, 1, 'is pending');

            vm.step();
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED) == 0, 'disables interrupts');
	        assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_FLAG) != 0, 'sets the interrupt flag');
            assert.assert(vm.regread(REGISTERS.SP) == 0x10 - 8, 'pushed IP: ' + vm.memreadl(vm.regread(REGISTERS.SP)));
            assert.assert(vm.regread(REGISTERS.IP) == 0x100 + 12 * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE, 'sets IP to 0x100 + 12*ISR_BYTE_SIZE: ' + vm.regread(REGISTERS.IP).toString(16));
            assert.equal(vm._pending_interrupts.length, 0, 'is no longer pending');
        }
      ]
    ],
    // 0x1
    [ "INC", "Increment X by OFFSET which is the 32 bits following the instruction. OFFSET is treated as a literal value (kind=0), relative address (kind=3), or an indirect relative address (kind=6). IP is advanced past OFFSET.",
      [ [ 'x', [ 0xf0, 4 ] ],
        [ 'condition', [ 0xF00, 8 ] ],
        [ 'kind', [ 0xF000, 12  ]],
        [ 'data', VM.TYPES.ULONG ]
      ],
      function(vm, ins) {
          var ip = vm.regread(REGISTERS.IP);
          
          if(vm.check_condition(ins.condition)) {
              var y = vm.memreadl(ip);
              
              if(ins.kind != 0 && ins.kind != 7) {
                  y = vm.memreadl(vm.regread(REGISTERS.IP) + y);
              }
              if(ins.kind == 6) {
                  y = vm.memreadl(y);
              }

              var result = vm.regread(ins.x) + y;
              vm.regwrite(ins.x, result);

              if(result > 0xFFFFFFFF) {
                  vm.set_status(VM.CPU.STATUS.ERROR);
                  vm.set_status(VM.CPU.STATUS.CARRY);
              } else {
                  vm.clear_status(VM.CPU.STATUS.ERROR);
                  vm.clear_status(VM.CPU.STATUS.CARRY);
              }
              
              if(ins.x != VM.CPU.REGISTERS.IP) {
                  vm.regwrite(REGISTERS.IP, ip + VM.CPU.REGISTER_SIZE);
              }
          } else {
              vm.regwrite(REGISTERS.IP, ip + VM.CPU.REGISTER_SIZE);
          }
      },
      function(vm, ins) {
          var reg = (ins & 0xF0) >> 4;
          if(reg >= VM.CPU.REGISTER_PARAMS) {
              return;
          }

          // no condition, literal offset
          vm.memwritel(0, vm.encode({ op: ins }));
          vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x2);
          vm.regwrite(reg, 0x12345678);
          vm.step();
          assert.assert(vm.regread(reg) == 0x1234567A, "R" + reg + " is incremented by 2 " + vm.regread(reg));
          assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");
          assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY) == 0, "clears the carry bit");
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP by a REGISTER_SIZE');

          // no condition, overflows
          vm.reset();
          vm.memwritel(0, vm.encode({op: ins}));
          vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 2);
          vm.regwrite(reg, 0xFFFFFFFF);
          vm.step();
          assert.assert(vm.regread(reg) == 0x1, "R" + reg + " is incremented by 2 " + vm.regread(reg));
          assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR, "sets the error bit");
          assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY, "sets the carry bit");
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP by a REGISTER_SIZE');

          // no condition, offset type
          vm.reset();
          vm.memwritel(0, vm.encode({op: ins, kind: 3}));
          vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x80 - VM.CPU.INSTRUCTION_SIZE);
          vm.memwritel(0x80, 0x2);
          vm.regwrite(reg, 0x12345678);
          vm.regwrite(REGISTERS.IP, 0);
          vm.step();
          assert.assert(vm.regread(reg) == 0x1234567A, "R" + reg + " is incremented by 2 " + vm.regread(reg));
          assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");
          assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY) == 0, "clears the carry bit");
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP by a REGISTER_SIZE');

          // no condition, indirect offset type
          vm.reset();
          vm.memwritel(0, vm.encode({op: ins, kind: 6}));
          vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x80 - VM.CPU.INSTRUCTION_SIZE);
          vm.memwritel(0x80, 0x70);
          vm.memwritel(0x70, 0x2);
          vm.regwrite(reg, 0x12345678);
          vm.regwrite(REGISTERS.IP, 0);
          vm.step();
          assert.assert(vm.regread(reg) == 0x1234567A, "R" + reg + " is incremented by 2 " + vm.regread(reg));
          assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.ERROR) == 0, "clears the error bit");
          assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.CARRY) == 0, "clears the carry bit");
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP by a REGISTER_SIZE');

          // condition, offset type
          vm.reset();
          vm.memwritel(0, vm.encode({op: ins, kind: 3, condition: VM.CPU.STATUS.NEGATIVE}));
          vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x80 - VM.CPU.INSTRUCTION_SIZE);
          vm.clear_status(VM.CPU.STATUS.OVERFLOW|VM.CPU.STATUS.NEGATIVE);
          vm.memwritel(0x80, 0x2);
          vm.regwrite(reg, 0x12345678);
          vm.regwrite(REGISTERS.IP, 0);
          vm.step();
          assert.assert(vm.regread(reg) != 0x1234567A, "R" + reg + " is not incremented by 2 " + vm.regread(reg));
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP by a REGISTER_SIZE');

          vm.set_status(VM.CPU.STATUS.NEGATIVE);
          vm.regwrite(REGISTERS.IP, 0);
          vm.step();
          assert.equal(vm.regread(reg), 0x1234567A, "R" + reg + " is incremented by 2 ");
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP by a REGISTER_SIZE');
      }
    ],
    // 0x2
    math_ops('I'),
    // 0x3
    math_ops('U'),
    // 0x4
    math_ops('F'),
    // 0x5
    [ "LOAD", "Load the whole register DEST with data from memory at the address found in REG + OFFSET, the following " + VM.CPU.REGISTER_SIZE + " bytes. If REG is STATUS then OFFSET is used directly. When REG is INS, then the value is used as is. Except when IP is loaded, IP is always advanced past the OFFSET.",
      [ [ 'dest', [ 0xF0, 4 ] ],
        [ 'condition', [ 0xF00, 8 ] ],
        [ 'reg', [ 0xF000, 12 ] ],
        [ 'data', VM.TYPES.ULONG ]
      ],
      function(vm, ins) {
          let ip = vm.regread(REGISTERS.IP);
          if(vm.check_condition(ins.condition)) {
              let offset = 0;
              if(ins.reg != VM.CPU.REGISTERS.STATUS && ins.reg != VM.CPU.REGISTERS.INS) {
                  offset = vm.regread(ins.reg);
                  offset += vm.memreadl(ip);
              } else {
                  offset += vm.memreadL(ip);
              }
              
              let value = 0;
              if(ins.reg == VM.CPU.REGISTERS.INS) {
                  value = offset;
              } else {
                  value = vm.memreadL(offset);
              }
			  vm.regwrite(ins.dest, value);

              if(ins.dest != VM.CPU.REGISTERS.IP) {
                  vm.regwrite(REGISTERS.IP, ip + VM.CPU.REGISTER_SIZE);
              }
          } else {
              vm.regwrite(REGISTERS.IP, ip + VM.CPU.REGISTER_SIZE);
          }
      },
      [
          function(vm, ins) {
              var reg = (ins & 0xF0) >> 4;
	          vm.memwritel(0, vm.encode({op: ins, reg: 2}));
              vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x30);
	          vm.memwrite(0x80, [ 0x44, 0x22 ]);
	          vm.regwrite(reg, 999);
              vm.regwrite(2, 0x50);
	          vm.regwrite(REGISTERS.IP, 0);
	          vm.step();
	          assert.assert(vm.regread(reg) == 0x2244, 'loads a value from memory into the register');
              assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');
          },
          function(vm, ins) {
              // to the status register
              var reg = (ins & 0xF0) >> 4;
	          vm.memwriteS(0, vm.encode({op: ins, reg: VM.CPU.REGISTERS.STATUS}));
              vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x30);
	          vm.memwrite(0x80, [ 0x44, 0x22, 0, 0 ]);
	          vm.memwrite(0x30, [ 0x88, 0x99, 0, 0 ]);
	          vm.regwrite(reg, 999);
              vm.regwrite(2, 0x50);
	          vm.regwrite(REGISTERS.IP, 0);
	          vm.step();
	          assert.equal(vm.regread(reg), 0x9988, 'loads into the register a value from memory with offseting from the status register');
              assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');
          },
          function(vm, ins) {
              // to the INS register
              var reg = (ins & 0xF0) >> 4;
	          vm.memwritel(0, vm.encode({op: ins, reg: VM.CPU.REGISTERS.INS}));
              vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x30);
	          vm.memwrite(0x80, [ 0x44, 0x22 ]);
	          vm.memwrite(0x30, [ 0x88, 0x99 ]);
	          vm.regwrite(reg, 999);
              vm.regwrite(2, 0x50);
	          vm.regwrite(REGISTERS.IP, 0);
	          vm.step();
	          assert.assert(vm.regread(reg) == 0x30, 'loads into the register the value');
              assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');
          },
          function(vm, ins) {
              // with a condition
              var reg = (ins & 0xF0) >> 4;
	          vm.memwritel(0, vm.encode({op: ins, condition: VM.CPU.STATUS.NEGATIVE, reg: 2}));
              vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x30);
	          vm.memwrite(0x80, [ 0x44, 0x22 ]);
              vm.clear_status(VM.CPU.STATUS.NEGATIVE);
	          vm.regwrite(reg, 999);
              vm.regwrite(2, 0x50);
	          vm.regwrite(REGISTERS.IP, 0);
	          vm.step();
	          assert.assert(vm.regread(reg) != 0x2244, 'does not load a value from memory into the register');
              assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');

              vm.regwrite(REGISTERS.IP, 0);
              vm.set_status(VM.CPU.STATUS.NEGATIVE);
              vm.step();
	          assert.assert(vm.regread(reg) == 0x2244, 'loads a value from memory into the register');
              assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');
          }
      ]
    ],
    // 0x6
    [ "POP", "Pop a value from the stack into the register.",
      [ [ 'dest', [ 0xF0, 4 ] ] ],
      function(vm, ins) {
          vm.pop(ins.dest);
      },
      function(vm, ins) {
          var reg = (ins & 0xF0) >> 4;
          vm.regwrite(0, 0x1234);
          vm.regwrite(REGISTERS.SP, vm.stack_start - 1);
	      vm.memwritel(0, vm.encode({op: VM.CPU.INS.PUSH, src: 0}));
	      vm.memwritel(VM.CPU.INSTRUCTION_SIZE, vm.encode({op: ins, dest: reg}));
	      vm.regwrite(REGISTERS.IP, 0);
	      vm.step();
          vm.regwrite(0, 0);
	      vm.step();
          if(reg == VM.CPU.REGISTERS.SP) {
	          assert.assert(vm.regread(reg) == 0x1234, 'stores the values from memory to R' + reg + ' ' + vm.regread(reg).toString(16));
          } else {
	          assert.equal(vm.regread(REGISTERS.SP), vm.stack_start - 1, "increments the stack pointer");
	          assert.equal(vm.regread(reg), 0x1234, 'stores the values from memory to R' + reg + ' ' + vm.regread(reg).toString(16));
          }
      }            
    ],
    // 0x7
    [ [ "CIE", "Clear interrupt enable bit.",
        {},
        function(vm, ins) {
            vm.disable_interrupts();
        },
        function(vm, ins) {
            vm.enable_interrupts();
            vm.memwritel(0, vm.encode({op: ins}));
            vm.step();
            assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED) == 0, 'clears the interrupt enable bit');
        }
      ],
      [ "RESET", "Reinitialize the CPU.",
        {},
        function(vm, ins) {
            vm.reset();
        },
        function(vm, ins) {
            vm.memwritel(0, vm.encode({op: ins}));
            vm.set_status(VM.CPU.STATUS.ERROR);
            vm.step();

            assert.equal(vm.regread(REGISTERS.STATUS), 0, 'clears the status register');
            for(var i = 0; i < VM.CPU.REGISTERS.GP_COUNT; i++) {
                assert.equal(vm.regread(i), 0, 'clears register ' + i);
            }
        }
      ],
      [ "BRK", "Cause a Break interrupt.", {},
        function(vm, ins) {
            vm.interrupt(VM.CPU.INTERRUPTS.brk);
        },
        [
            // interrupts disabled
            function(vm, ins) {
                vm.keep_running = true;
                vm.memwritel(0, vm.encode({op: ins}));
                vm.regwrite(REGISTERS.ISR, 0x100);
                vm.step();
                assert.equal(vm.interrupts_pending(), 0, 'does not queue an interrupt');
            },
            // interrupts enabled
            function(vm, ins) {
                var isr_addr = 0x100 + (VM.CPU.INTERRUPTS.brk * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE);
                vm.keep_running = false;
                vm._pending_interrupts = [];
                vm.memwritel(0, vm.encode({op: ins}));
                vm.memwritel(isr_addr, vm.encode({op: VM.CPU.INS.HALT}));
                vm.enable_interrupts();
                vm.regwrite(REGISTERS.ISR, 0x100);
                vm.step();
                assert.equal(vm.interrupts_pending(), 1, 'queues the interrupt');
                vm.step();
                assert.equal(vm.interrupts_pending(), 0, 'processed the interrupt');
                assert.equal(vm.regread(REGISTERS.IP), isr_addr, 'jumps to the break interrupt');
            }
        ]
      ],
      [],
      [],
      [],
      [ "MEMSET", "Sets count bytes from the address in X to the value in Y." ],
      [ "CALL", "Push IP + " + VM.CPU.REGISTER_SIZE + ", and then set IP to the OFFSET following the instruction. When REG is not STATUS or INS, that register's value is added to OFFSET.",
        [ [ 'condition', [ 0xF00, 8 ] ],
          [ 'reg', [ 0xF000, 12 ] ],
          [ 'data', VM.TYPES.ULONG ]
        ],
        function(vm, ins) {
            let ip = vm.regread(REGISTERS.IP);
            vm.regwrite(REGISTERS.IP, ip + VM.CPU.REGISTER_SIZE);
            
            if(vm.check_condition(ins.condition)) {
                let offset = vm.memreadl(ip);
                if(ins.reg != VM.CPU.REGISTERS.STATUS && ins.reg != VM.CPU.REGISTERS.INS) {
                    offset = vm.regread(ins.reg) + offset;
                }
                vm.push_register(REGISTERS.IP);
                vm.regwrite(REGISTERS.IP, offset);
            }
        },
        [
            function(vm, ins) {
                vm.regwrite(REGISTERS.SP, 0x100);
                vm.memwrite(0x90, new Array(0x20));
                vm.set_status(VM.CPU.STATUS.NEGATIVE);
                vm.memwritel(0, vm.encode({op: ins, reg: VM.CPU.REGISTERS.STATUS}));
                vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x80);
                vm.step();
                assert.equal(vm.regread(REGISTERS.IP), 0x80, 'sets IP to offset');
                assert.equal(vm.memreadL(vm.regread(REGISTERS.SP) + 0), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'pushed IP');
            },
            // conditioned
            function(vm, ins) {
                vm.regwrite(REGISTERS.SP, 0x100);
                vm.memwrite(0x90, new Array(0x20));
                vm.set_status(VM.CPU.STATUS.ZERO);
                vm.memwritel(0, vm.encode({op: ins, reg: VM.CPU.REGISTERS.STATUS, condition: VM.CPU.STATUS.NEGATIVE}));
                vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x80);

                // without matching status
                vm.clear_status(VM.CPU.STATUS.NEGATIVE);
                vm.step();
                assert.not_equal(vm.regread(REGISTERS.IP), 0x80, 'sets IP to offset');
                assert.not_equal(vm.memreadL(vm.regread(REGISTERS.SP) + 4), 0x8, 'pushed IP');
                assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');

                // with matching status
                vm.set_status(VM.CPU.STATUS.NEGATIVE);
                vm.regwrite(REGISTERS.IP, 0);
                vm.step();
                assert.equal(vm.regread(REGISTERS.IP), 0x80, 'sets IP to offset');
                assert.equal(vm.memreadL(vm.regread(REGISTERS.SP) + 0), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'pushed IP');
            }
        ]
      ],
      [ "SIE", "Set the interrupt enable bit.",
        {},
        function(vm, ins) {
            vm.enable_interrupts();
        },
        function(vm, ins) {
            vm.disable_interrupts();
            vm.memwritel(0, vm.encode({op: ins}));
            vm.step();
            assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED) != 0, 'sets the interrupt enable bit');
        }
      ],
      [ "SLEEP", "Sleeps the CPU.", [],
        function(vm, ins) {
            if(vm.debug) console.log("SLEEP", vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.SLEEP, vm.cycles);
            vm.set_status(VM.CPU.STATUS.SLEEP);
            vm.clear_status(VM.CPU.STATUS.INT_FLAG); // want interrupts to not queue
            return true;
        },
        function(vm, ins) {
            vm.memwritel(0, vm.encode({op: ins}));
            assert.equal(vm.step(), false, 'causes step to return false');
            assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.SLEEP) != 0, 'sets the sleep status bit');
            assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_FLAG) == 0, 'clears the INT_FLAG bit');
        }
      ],
      [],
      [],
      [ "RET", "Pop IP returning from a CALL.", {},
        function(vm, ins) {
            vm.pop(REGISTERS.IP);
        },
        function(vm, ins) {
            vm.memwritel(0, vm.encode({op: ins}));
            vm.regwrite(REGISTERS.SP, 0x100);
            vm.push_value(VM.CPU.STATUS.NEGATIVE);
            vm.push_value(0x30);
            vm.step();

            assert.equal(vm.regread(REGISTERS.SP), 0x100 - VM.CPU.REGISTER_SIZE, 'popped value from the stack');
            assert.equal(vm.regread(REGISTERS.IP), 0x30, 'sets IP to value on the stack');
        }
      ],
      [],
      [ "MEMCPY", "Copies count bytes starting from X to Y." ],
      [ "CALLR", "Push IP + " + VM.CPU.REGISTER_SIZE + ", and then set IP to the register REG + value of the OFFSET register. When REG is not STATUS or INS, that register's value is added to OFFSET. STATUS and INS are treated as zeros.",
        [ [ 'offset', [ 0xF000, 12 ] ],
          [ 'reg', [ 0xF00, 8 ] ]
        ],
        function(vm, ins) {
            let ip = vm.regread(REGISTERS.IP);
            let offset = vm.regread(ins.offset);
            if(ins.reg != VM.CPU.REGISTERS.STATUS && ins.reg != VM.CPU.REGISTERS.INS) {
                offset = vm.regread(ins.reg) + offset;
            }

            vm.push_register(REGISTERS.IP);
            vm.regwrite(REGISTERS.IP, offset);
        },
        [
            function(vm, ins) {
                vm.regwrite(REGISTERS.SP, 0x100);
                vm.memwrite(0x90, new Array(0x20));
                vm.set_status(VM.CPU.STATUS.NEGATIVE);
                vm.memwritel(0, vm.encode({op: ins, reg: VM.CPU.REGISTERS.STATUS, offset: 0}));
                vm.regwrite(0, 0x80);
                vm.memwritel(0x80, 0x40);
                vm.step();
                assert.equal(vm.regread(REGISTERS.IP), 0x80, 'sets IP to offset');
                assert.equal(vm.memreadL(vm.regread(REGISTERS.SP) + 0), VM.CPU.INSTRUCTION_SIZE, 'pushed IP');
            },
            function(vm, ins) {
                vm.regwrite(REGISTERS.SP, 0x100);
                vm.memwrite(0x90, new Array(0x20));
                vm.set_status(VM.CPU.STATUS.NEGATIVE);
                vm.memwritel(0, vm.encode({op: ins, reg: 1, offset: 2}));
                vm.regwrite(1, 0x80);
                vm.regwrite(2, 0x10);
                vm.memwritel(0x10, 0x40);
                vm.step();
                assert.equal(vm.regread(REGISTERS.IP), 0x80 + 0x10, 'sets IP to reg + offset');
                assert.equal(vm.memreadL(vm.regread(REGISTERS.SP) + 0), VM.CPU.INSTRUCTION_SIZE, 'pushed IP');
            }
        ]
      ]
    ],
    // 0x8
    [ "MOV", "Transfer the value in X to DEST.",
      [ [ 'dest', [ 0xF0, 4 ] ],
        [ 'src', [ 0xF00, 8 ] ]
      ],
      function(vm, ins) {
		  vm.regwrite(ins.dest, vm.regread(ins.src));
      },
      function(vm, ins) {
          var reg = (ins & 0xF0) >> 4;
          if(reg == VM.CPU.REGISTERS.IP) {
              return;
          }
	      vm.regwrite(reg == 2 ? 1 : 2, 123);
	      vm.regwrite(reg, 456);
	      vm.memwritel(0, vm.encode({op: ins, dest: reg, src: reg == 2 ? 1 : 2 }));
	      vm.regwrite(REGISTERS.IP, 0);
	      vm.step();
	      assert.assert(vm.regread(reg) == 123, 'assigns the dest register R' + reg + ' : ' + vm.regread(reg));
      }
    ],
    // 0x9
    [ "DEC", "Decrement X by OFFSET which is the 32 bits following the instruction. OFFSET is treated as a literal value (kind=0), relative address (kind=3), or an indirect relative address (kind=6). IP is advanced past OFFSET.",
      [ [ 'x', [ 0xf0, 4 ] ],
        [ 'condition', [ 0xF00, 8 ] ],
        [ 'kind', [ 0xF000, 12 ] ],
        [ 'data', VM.TYPES.ULONG ]
      ],
      function(vm, ins) {
          var ip = vm.regread(REGISTERS.IP)
          if(vm.check_condition(ins.condition)) {
              var y = vm.memreadl(ip);

              if(ins.kind != 0 && ins.kind != 7) {
                  y = vm.memreadl(vm.regread(REGISTERS.IP) + y);
              }
              if(ins.kind == 6) {
                  y = vm.memreadl(y);
              }

              var result = vm.regread(ins.x) - y;
              vm.regwrite(ins.x, result);

              if(result < 0) {
                  vm.set_status(VM.CPU.STATUS.NEGATIVE);
              } else {
                  vm.clear_status(VM.CPU.STATUS.NEGATIVE);
              }

              if(ins.x != VM.CPU.REGISTERS.IP) {
                  vm.regwrite(REGISTERS.IP, ip + VM.CPU.REGISTER_SIZE);
              }
          } else {
              vm.regwrite(REGISTERS.IP, ip + VM.CPU.REGISTER_SIZE);
          }
      },
      function(vm, ins) {
          var reg = (ins & 0xf0) >> 4;
          if(reg >= VM.CPU.REGISTER_PARAMS) {
              return;
          }

          // no condition, literal offset
          vm.memwritel(0, vm.encode({op: ins, kind: 0}));
          vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 2);
          vm.regwrite(reg, 0x12345678);
          vm.step();
          assert.assert(vm.regread(reg) == 0x12345676, "R" + reg + " is decremented by 2 " + vm.regread(reg));
          assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.NEGATIVE) == 0, "clears the negative bit");
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');

          // no condition, goes negative
          vm.reset();
          vm.memwritel(0, vm.encode({op: ins, kind: 0}));
          vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 2);
          vm.regwrite(reg, 0x1);
          vm.regwrite(reg == 1 ? 2 : 1, 0x2);
          vm.step();
          assert.assert(vm.regread(reg) == 0xFFFFFFFF, "R" + reg + " is decremented by 2 " + vm.regread(reg));
          assert.assert(vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.NEGATIVE, "sets the negative bit");
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');

          // no condition, offset type
          vm.reset();
          vm.memwritel(0, vm.encode({op: ins, kind: 3}));
          vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x80 - VM.CPU.INSTRUCTION_SIZE);
          vm.memwritel(0x80, 0x2);
          vm.regwrite(reg, 0x12345678);
          vm.regwrite(REGISTERS.IP, 0);
          vm.step();
          assert.assert(vm.regread(reg) == 0x12345676, "R" + reg + " is decremented by 2 " + vm.regread(reg));
          assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.NEGATIVE) == 0, "clears the negative bit");
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');

          // no condition, indirect offset type
          vm.reset();
          vm.memwritel(0, vm.encode({op: ins, kind: 6}));
          vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x80 - VM.CPU.INSTRUCTION_SIZE);
          vm.memwritel(0x80, 0x70);
          vm.memwritel(0x70, 0x2);
          vm.regwrite(reg, 0x12345678);
          vm.regwrite(REGISTERS.IP, 0);
          vm.step();
          assert.assert(vm.regread(reg) == 0x12345676, "R" + reg + " is decremented by 2 " + vm.regread(reg));
          assert.assert((vm.regread(REGISTERS.STATUS) & VM.CPU.STATUS.NEGATIVE) == 0, "clears the negative bit");
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');

          // condition, offset type
          vm.reset();
          vm.memwritel(0, vm.encode({op: ins, kind: 3, condition: VM.CPU.STATUS.NEGATIVE}));
          vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x80 - VM.CPU.INSTRUCTION_SIZE);
          vm.clear_status(VM.CPU.STATUS.NEGATIVE);
          vm.memwritel(0x80, 0x2);
          vm.regwrite(reg, 0x12345678);
          vm.regwrite(REGISTERS.IP, 0);
          vm.step();
          assert.assert(vm.regread(reg) != 0x12345676, "R" + reg + " is not decremented by 2 " + vm.regread(reg));
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');

          vm.set_status(VM.CPU.STATUS.NEGATIVE);
          vm.regwrite(REGISTERS.IP, 0);
          vm.step();
          assert.assert(vm.regread(reg) == 0x12345676, "R" + reg + " is decremented by 2 " + vm.regread(reg));
          assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');
      }
    ],
    // 0xA
    [ [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      []     
    ],
    // 0xB
    [],
    // 0xC
    [],
    // 0xD
    [ "STORE", "Store the whole register SRC at the address REG + OFFSET. If REG is STATUS or INS then REG is not added. OFFSET is the " + VM.CPU.REGISTER_SIZE + " bytes following the instruction. IP is always advanced past this.",
      [ [ 'src', [ 0xF0, 4 ] ],
        [ 'condition', [ 0xF00, 8 ] ],
        [ 'reg', [ 0xF000, 12  ] ],
        [ 'data', VM.TYPES.ULONG ]
      ],
      function(vm, ins) {
          let ip = vm.regread(REGISTERS.IP);
          if(vm.check_condition(ins.condition)) {
              let offset = 0;
              if(ins.reg != VM.CPU.REGISTERS.STATUS && ins.reg != VM.CPU.REGISTERS.INS) {
                  offset = vm.regread(ins.reg);
                  offset += vm.memreadl(ip);
              } else {
                  offset = vm.memreadL(ip);
              }
              vm.memwritel(offset, vm.regread(ins.src));
          }

          vm.regwrite(REGISTERS.IP, ip + VM.CPU.REGISTER_SIZE);
      },
      [
          // address in register
          function(vm, ins) {
              var reg = (ins & 0xF0) >> 4;
	          vm.memwritel(0, vm.encode({op: ins, src: reg, reg: reg == 1 ? 3 : 1 }));
              vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x30);
	          vm.memwrite(0x80, [ 0x44, 0x22 ]);
	          vm.regwrite(reg, 999);
              vm.regwrite(reg == 1 ? 3 : 1, 0x50);
	          vm.regwrite(REGISTERS.IP, 0);
	          vm.step();
	          assert.assert(vm.memreadl(0x80) == 999, 'stores the registers value to memory');
              assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');
          },
          // conditioned
          function(vm, ins) {
              var reg = (ins & 0xF0) >> 4;
	          vm.memwritel(0, vm.encode({op: ins, src: reg, reg: reg == 1 ? 3 : 1, condition: VM.CPU.STATUS.NEGATIVE }));
              vm.memwritel(VM.CPU.INSTRUCTION_SIZE, 0x30);
	          vm.memwrite(0x80, [ 0x44, 0x22 ]);
	          vm.regwrite(reg, 999);
              vm.regwrite(reg == 1 ? 3 : 1, 0x50);
	          vm.regwrite(REGISTERS.IP, 0);
              vm.clear_status(VM.CPU.STATUS.NEGATIVE);
	          vm.step();
	          assert.assert(vm.memreadl(0x80) != 999, 'does not store the registers value to memory');
              assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');

	          vm.regwrite(REGISTERS.IP, 0);
              vm.set_status(VM.CPU.STATUS.NEGATIVE);
	          vm.step();
	          assert.assert(vm.memreadl(0x80) == 999, 'stores the registers value to memory');
              assert.equal(vm.regread(REGISTERS.IP), VM.CPU.INSTRUCTION_SIZE + VM.CPU.REGISTER_SIZE, 'increased IP');
          }          
      ]
    ],
    // 0xE
    [ "PUSH", "Pushes the specified register onto the stack.",
      [ [ 'src', [ 0x000000F0, 4 ] ] ],
      function(vm, ins) {
          vm.push_register(ins.src);
      },
      function(vm, ins) {
          var reg = (ins & 0xF0) >> 4;
	      vm.memwritel(0, vm.encode({op: ins, src: reg}));
	      vm.regwrite(reg, 123);
	      vm.regwrite(REGISTERS.IP, 0);
	      vm.step();
	      assert.assert(vm.regread(REGISTERS.SP) == vm.stack_start - 4, "decrements the stack pointer");
	      assert.assert(vm.memreadl(vm.stack_start - 4, 4) == 123, 'writes to memory at SP');
      }
    ],
    // 0xF
    []
];

VM.CPU.ArgMask = function(name, mask, shiftr)
{
    this.name = name;
    this.mask = mask;
    if(!mask) throw "Mask required: " + name;
    this.shiftr = shiftr || 0;
}

VM.CPU.ArgMask.prototype.get = function(ins)
{
    return (ins & this.mask) >> this.shiftr;
}

VM.CPU.ArgMask.prototype.shift = function(n)
{
    return (n << this.shiftr) & this.mask;
}

VM.CPU.Instruction = function(op, name, doc, arg_masks, has_literal, impl, tests)
{
    this.op = op;
    this.name = name;
    this.doc = doc;
    this.arg_masks = this.populate_argmasks(arg_masks);
    this.has_literal = has_literal;
    this.byte_size = VM.TYPES.SHORT.byte_size + this.has_literal.byte_size;
    this.impl = impl;
    this.tests = tests;
}

VM.CPU.Instruction.prototype.populate_argmasks = function(arg_masks)
{
    // populate arg masks from this instruction's definition
    var m = new Map();

    // dispatch table arg masks come in as VM.CPU.ArgMask instances
    util.map_each(arg_masks, function(name, mask) {
        if(mask.constructor != VM.CPU.ArgMask) {
            if(name.match(/\d+/)) {
                name = mask[0];
                mask = mask[1];
            }

            mask = new VM.CPU.ArgMask(name, mask[0], mask[1], mask[2]);
        }
        m[name.toLowerCase()] = mask;
    });
    // keep args from the dispatch tables from taking the map's first slots
    util.map_each(arg_masks, function(name, mask) {
        if(mask.constructor == VM.CPU.ArgMask) {
            m[name.toLowerCase()] = mask;
        }
    });

    return m;
}

VM.CPU.Instruction.prototype.call = function(vm, ins)
{
    var args = this.unmask(ins);
    return this.impl(vm, args);
}

VM.CPU.Instruction.prototype.unmask = function(ins)
{
    var r = util.map_each(this.arg_masks, function(name, mask) {
        return mask.get(ins);
    });

    r[0] = ins;
    return r;
}

VM.CPU.Instruction.prototype.mask = function(opts)
{
    var n = opts.op | 0;
    
    util.map_each(this.arg_masks, function(name, mask) {
        n = n | mask.shift(opts[name] || 0);
    });
    
    return n;
}

VM.CPU.Instruction.prototype.encoder_list = function(args)
{
    if(args.constructor != Array) {
        args = Array.from(arguments);
    }
    
    var opts = { op: this.op };

    var i = 0;
    for(var arg_name in this.arg_masks) {
        if(arg_name == 'highop' || arg_name == 'lowop') continue;
        
        var v = args[i++];
        if(v) {
            opts[arg_name] = v;
        }
    }

    return opts;
}

VM.CPU.Instruction.prototype.run_tests = function(vm, inst)
{
    if(typeof(this.tests) == "function") {
        vm.reset();
        this.tests(vm, inst);
        return 1;
    } else if(this.tests) {
        var i = 0;
        for(; i < this.tests.length; i++) {
            vm.reset();
            this.tests[i](vm, inst);
        }

        return i;
    } else {
        return 0;
    }
}

VM.CPU.INS = [];
VM.CPU.INS_INST = [];
VM.CPU.INS_DISPATCH = new DispatchTable(0xF, 0);

function add_ins_to_tables(op, opts, masks)
{
    var ins = VM.CPU.INS_INST[op];
    if(!ins) {
        var arg_masks = {};
        var has_literal = false;
        util.map_each_n(masks, function(mask) {
            arg_masks[mask.name] = mask;
        });
        util.map_each(opts[2], function(name, mask) {
            if(name == 'data' || mask[0] == 'data') {
                if(typeof(mask[1]) == 'number')
                    has_literal = VM.TYPES[mask[1]];
                else if(mask[1] instanceof VM.Type)
                    has_literal = mask[1];
                else
                    throw "Unknown type: " + mask[1];
            } else {
                arg_masks[name] = mask;
            }
        });
        
        ins = VM.CPU.INS_INST[VM.CPU.INS[opts[0]]];
        if(!ins) {
            ins = new VM.CPU.Instruction(op, opts[0], opts[1], arg_masks, has_literal, opts[3], opts[4]);
        }
        VM.CPU.INS_INST[op] = ins;
    }
    if(!VM.CPU.INS[opts[0]]) {
        VM.CPU.INS[opts[0]] = op;
    }

    return ins;
}

function build_ins_tables(ins_defs, name, mask, shift, op, masks)
{
    if(!op) {
        op = 0;
    }
    if(!shift) {
        shift = 0;
    }
    if(!mask) {
        mask = 0xF;
    }
    if(!masks) masks = [];
    var tbl = new DispatchTable(mask, shift);
    tbl.arg_mask = new VM.CPU.ArgMask(name, mask, shift);
    
    for(var i = 0; i < ins_defs.length; i++) {
        var ins = ins_defs[i];
        if(ins == null) {
            continue;
        }

        var new_op = op | (i << shift);
        if(ins.mask != null && ins.ops != null) {
            var new_tbl = build_ins_tables(ins.ops, ins.name, ins.mask, ins.shift, new_op, masks.concat([tbl.arg_mask]))
            tbl.set(i, new_tbl);
        } else if(typeof(ins[0]) == 'string' && (typeof(ins[3]) == 'function' || ins[3] == null)) {
            var inst = add_ins_to_tables(new_op, ins, masks.concat([tbl.arg_mask]));
            tbl.set(i, inst);
        } else if(ins.length > 0 && ins.constructor == Array) {
            var new_tbl = build_ins_tables(ins, 'highop', 0xF << (shift+4), shift+4, new_op, masks.concat([tbl.arg_mask]))
            tbl.set(i, new_tbl);
        }
    }

    return tbl;
}

VM.CPU.INS_DISPATCH = build_ins_tables(VM.CPU.INS_DEFS, 'lowop', 0xF, 0);

VM.UnknownInstructionError = "Unknown instruction";
VM.InvalidRegisterError = "Invalid register error";
VM.MemoryFaultError = "Memory fault error";

VM.CPU.prototype.run = function(cycles)
{
    if(this.debug) console.log("CPU run", cycles);
    var i = 0;
    this.halted = false;
    this.keep_running = true;
    this.running = true;
    
    do {
		this.keep_running = this.step();
        i++;
	} while((cycles == null || i < cycles)
            && (this.keep_running != false && this.halted == false)
            || (this.interrupts_pending()
                && (this.check_condition(VM.CPU.STATUS.INT_ENABLED)
                    || this.check_condition(VM.CPU.STATUS.INT_FLAG))));

	return this;
}

VM.CPU.prototype.stop = function()
{
    this.halted = true;
    this.running = false;
}

VM.CPU.prototype.encode = function(opts)
{
    return VM.CPU.encode(opts);
}

VM.CPU.prototype.decode = function(ins, tbl)
{
    return VM.CPU.decode(ins, tbl);
}

VM.CPU.encode = function(opts)
{
    var ins = this.decode(opts.op);
    return ins.mask(opts);
}

VM.CPU.decode = function(ins, tbl)
{
    if(!tbl) {
        tbl = VM.CPU.INS_DISPATCH;
    }

    var i = tbl.get(ins);
    if(i.constructor == DispatchTable) {
        return this.decode(ins, i);
    } else {
        return i;
    }
}

VM.CPU.prototype.unknown_op = function(ins, ip)
{
    if(this.exceptional) {
        throw(VM.UnknownInstructionError);
    } else {
        this.interrupt(VM.CPU.INTERRUPTS.unknown_op);
    }
}

VM.CPU.prototype.do_step = function()
{
    if((this.halted || (this.regread(REGISTERS.STATUS) & VM.CPU.STATUS.SLEEP) != 0)
       && !this.check_condition(VM.CPU.STATUS.INT_ENABLED|VM.CPU.STATUS.INT_FLAG)) {
        return false;
    }
    
    this.running = true;
    this.stepping = true;
    this.cycles++;
    
    if(!this.do_interrupt()) {
        let ip = this.regread(REGISTERS.IP);
	    let ins = this.memreadS(ip);

	    this.regwrite('ins', ins);
        this.regwrite(REGISTERS.IP, ip + VM.CPU.INSTRUCTION_SIZE);

        let i = this.decode(ins);
        if(i) {
            if(i.call(this, ins) == true) {
                this.stepping = false;
                return false;
            }
        } else {
            this.unknown_op(ins, ip);
        }
    }

    this.stepping = false;
	return this;
}

VM.CPU.prototype.step = function()
{
    try {
        return this.do_step();
    } catch(e) {
        this.stepping = false;
        if(e == DispatchTable.UnknownKeyError) {
            this.unknown_op(this.regread('ins'), this.regread(REGISTERS.IP));
        } else if(e instanceof VM.MMU.NotMappedError) {
            this.interrupt(VM.CPU.INTERRUPTS.mem_fault);
        } else if(e instanceof RangedHash.InvalidAddressError) {
            this.interrupt(VM.CPU.INTERRUPTS.mem_fault);
        } else if(e instanceof PagedHash.NotMappedError) {
            this.interrupt(VM.CPU.INTERRUPTS.mem_fault);
        } else {
            if(this.exceptional) {
                throw(e);
            }
        }

        return this;
    }
}

VM.CPU.prototype.dbstep = function(cycles)
{
    var ip = this.regread(REGISTERS.IP);

    if(!cycles) { cycles = 1; }
    
    for(var i = 0; i < cycles; i++) {
        this.step();
    }

    return this.debug_dump();
}

VM.CPU.prototype.debug_dump = function(ip_offset)
{
    console.log("Cycle", this.cycles);
    
    var ip = this.regread(REGISTERS.IP);
    if(ip_offset) ip += ip_offset;
    
    try {
        var op = this.memreadS(ip);
        var ins = this.decode(op)
        console.log("Instruction", "@0x" + ip.toString(16), "0x" + op.toString(16), "0x" + this.memreadL(ip + VM.CPU.INSTRUCTION_SIZE).toString(16));
        console.log("           ", "@" + ip, op, this.memreadL(ip + VM.CPU.INSTRUCTION_SIZE));
        console.log("  ", ins ? ins.name : 'unknown', ins.unmask(op));
    } catch(e) {
        console.log("Error decoding INS", ip)
    }
    var self = this;
    var stack = util.n_times(Math.min(this.debug_stack_size || 16, this.stack_start, this.regread(REGISTERS.SP)), function(n) {
        try {
            return self.memreadL(self.regread(REGISTERS.SP) + n * VM.CPU.REGISTER_SIZE);
        } catch(e) {
            return 0;
        }
    });;
    console.log("Registers");
    console.log("0x", util.map_each_n(this._reg, function(i, n) { return i.toString(16); }).join(", "));
    console.log("  ", this._reg.join(", "));

    console.log("Stack", this.regread(REGISTERS.SP), "0x" + this.regread(REGISTERS.SP).toString(16));
    console.log("0x", util.map_each_n(stack, function(i, n) { return i.toString(16); }).join(", "));
    console.log("  ", stack.join(", "));

    console.log();
    
    return this;
}

VM.CPU.prototype.push_register = function(reg)
{
    let v = this.regread(reg);
	let sp = this.regread(REGISTERS.SP) - 4;
	this.memwritel(sp, v);
	this.regwrite(REGISTERS.SP, sp);
    return this;
}

VM.CPU.prototype.push_value = function(v)
{
    if(typeof(v) == 'string') v = this.regread(v);
	let sp = this.regread(REGISTERS.SP) - 4;
	this.memwritel(sp, v);
	this.regwrite(REGISTERS.SP, sp);
    return this;
}

VM.CPU.prototype.pop = function(reg)
{
	this.regwrite(reg, this.memreadL(this.regread(REGISTERS.SP)));
    if(register_index(reg) != register_index(REGISTERS.SP)) {
		this.regwrite(REGISTERS.SP, this.regread(REGISTERS.SP) + 4);
    }
    return this;
}

VM.CPU.prototype.reset = function()
{
	for(var i = 0; i < 16; i++) {
		this.regwrite(i, 0);
	}
	this.regwrite(REGISTERS.STATUS, 0);
	this.regwrite(REGISTERS.SP, this.stack_start);
    this.halted = false;
    this._pending_interrupts = [];
    this.interrupt(VM.CPU.INTERRUPTS.reset);
	return this;
}

VM.CPU.prototype.map_memory = function(addr, size, responder)
{
    this.mmu.map_memory(addr, size, responder);
    return this;
}

VM.CPU.prototype.memread = function(addr, count)
{
    return this.mmu.memread(addr, count);
}

VM.CPU.prototype.memreadl = function(addr)
{
    return this.mmu.memreadl(addr);
}

VM.CPU.prototype.memreadL = function(addr)
{
    return this.mmu.memreadL(addr);
}

VM.CPU.prototype.memreadS = function(addr)
{
    return this.mmu.memreadS(addr);
}

VM.CPU.prototype.memwrite = function(addr, data, type)
{
    return this.mmu.memwrite(addr, data, type);
}

VM.CPU.prototype.memwritel = function(addr, n)
{
    return this.mmu.memwritel(addr, n);
}

VM.CPU.prototype.memwriteL = function(addr, n)
{
    return this.mmu.memwriteL(addr, n);
}

VM.CPU.prototype.memwrites = function(addr, n)
{
    return this.mmu.memwrite(addr, n);
}

VM.CPU.prototype.memwriteS = function(addr, n)
{
    return this.mmu.memwriteS(addr, n);
}

function register_index(reg)
{
    if(typeof(reg) == "number") {
        return reg;
    } else {
        var r = VM.CPU.REGISTERS[reg.toUpperCase()];
        if(r == null) throw VM.InvalidRegisterError;
        else return r;
    }
}

VM.CPU.prototype.regread = function(reg, type)
{
    var index = register_index(reg);
    if(type == VM.TYPES.ULONG || type == null) {
       return this._reg[index];
    } else {
        var offset = index * VM.CPU.REGISTER_SIZE;
        if(typeof(type) == 'number' || typeof(type) == 'string') type = VM.TYPES[type];
        if(!type) type = VM.TYPES.ULONG;
        return type.get(this._reg_view, offset, true);
    }
}

VM.CPU.prototype.regreadf = function(reg)
{
    return this.regread(reg, VM.TYPES.FLOAT);
}

VM.CPU.prototype.regwrite = function(reg, value, type)
{
    var index = register_index(reg);
    if(type == VM.TYPES.ULONG || type == null) {
        this._reg[index] = value;
    } else {
        var offset = index * VM.CPU.REGISTER_SIZE;
        if(typeof(type) == 'number' || typeof(type) == 'string') type = VM.TYPES[type];
        if(!type) type = VM.TYPES.ULONG;
        type.set(this._reg_view, offset, value, true);
    }
    
	return this;
}

VM.CPU.prototype.regwritef = function(reg, value)
{
    return this.regwrite(reg, value, VM.TYPES.FLOAT);
}

VM.CPU.prototype.set_status = function(bits)
{
    this.regwrite(REGISTERS.STATUS, this.regread(REGISTERS.STATUS) | bits);
    return this;
}

VM.CPU.prototype.clear_status = function(bits)
{
    this.regwrite(REGISTERS.STATUS, this.regread(REGISTERS.STATUS) & ~bits);
}

VM.CPU.prototype.check_condition = function(bits)
{
    return bits == 0 || (this.regread(REGISTERS.STATUS) & bits) != 0;
}

VM.CPU.prototype.interrupt = function(interrupt)
{
    if(this.debug) {
        console.log("Interrupt", interrupt, VM.CPU.INTERRUPTS[interrupt],
                    this.regread(REGISTERS.STATUS) & VM.CPU.STATUS.SLEEP,
                    this.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED,
                    this.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_FLAG,
                    this.regread(REGISTERS.IP),
                    this.regread(REGISTERS.SP),
                    Date.now());
        this.debug_dump();
    }

    // todo need to queue when inside an ISR w/ INT_ENABLED = 0
    if((this.regread(REGISTERS.STATUS) & (VM.CPU.STATUS.INT_ENABLED | VM.CPU.STATUS.INT_FLAG)) != 0) {
        this._pending_interrupts.push(interrupt);
        /*
    if((this.regread(REGISTERS.STATUS) & VM.CPU.STATUS.SLEEP) != 0) {
      if(this.keep_running == false) {
        if(this.debug) console.log("CPU Waking");
        this.run(this.max_cycles);
      }
    }
*/
    }
    
    return this;
}

VM.CPU.prototype.interrupts_pending = function()
{
    return this._pending_interrupts.length;
}

VM.CPU.prototype.do_interrupt = function()
{
    if((this.regread(REGISTERS.STATUS) & VM.CPU.STATUS.INT_ENABLED)
       && this._pending_interrupts.length > 0) {
        this.push_register(REGISTERS.IP);
        this.push_register(REGISTERS.STATUS);
        this.set_status(VM.CPU.STATUS.INT_FLAG);
        this.disable_interrupts();
        var intr = this._pending_interrupts.shift();
        this.regwrite(REGISTERS.IP, this.regread(REGISTERS.ISR) + intr * VM.CPU.INTERRUPTS.ISR_BYTE_SIZE);
        if(this.debug) console.log("Doing interrupt", intr, this.regread(REGISTERS.IP));

        return true;
    } else {
        return false;
    }
}

VM.CPU.prototype.disable_interrupts = function()
{
    this.clear_status(VM.CPU.STATUS.INT_ENABLED);
    return this;
}

VM.CPU.prototype.enable_interrupts = function()
{
    this.set_status(VM.CPU.STATUS.INT_ENABLED);
    if(this.debug) console.log("Pending interrupts", this._pending_interrupts);
    return this;
}


function vm_run_dispatch_table_tests(tbl, vm, op)
{
    var num_tests = 0;
    var max = tbl.mask >> tbl.shift;
    if(!op) op = 0;

    for(var key = 0; key <= max; key++) {
        var new_op = (key << tbl.shift) | op;
        if(tbl.has(new_op)) {
            var v = tbl.get(new_op);
            if(v.run_tests) {
                var n = v.run_tests(vm, new_op);
                num_tests += n;
            } else if(v.get) {
                var n = vm_run_dispatch_table_tests(v, vm, new_op);
                num_tests += n;
            }
        }
    }

    return num_tests;
}

const RAM = require("vm/devices/ram.js");

VM.CPU.test_suite = function()
{
    var num_tests = 0;
    var mmu = new VM.MMU();
    var mem_size = 1<<16;
	var vm = new VM.CPU(mmu, mem_size);
    vm.exceptional = true;

    // exercise memread/write's ability to span memory regions
    var split_at = PagedHash.PageSize;
    mmu.map_memory(0, split_at, new RAM(split_at));
    mmu.map_memory(split_at, mem_size - split_at, new RAM(mem_size - split_at));
    var seq = util.n_times(128, function(n) { return n; });
    vm.memwrite(0, seq);
    assert.equal(Array.from(vm.memread(0, seq.length)), seq, 'reads what was written');

    // run the instruction tests
    num_tests += vm_run_dispatch_table_tests(VM.CPU.INS_DISPATCH, vm);

    // unknown op interrupt
    vm.reset();
    vm.memwrite(0, [ 0xFF, 0xFF, 0xFF, 0xFF ]);
    assert.is_thrown(function() { vm.step(); }, VM.UnknownInstructionError, "because it is exceptional");
    
    vm.reset();
    vm.enable_interrupts();
    vm.exceptional = false;
    vm.step();
    assert.assert(vm.interrupts_pending(), 'has an interrupt');

    console.log("" + num_tests + " tests ran.");
	return vm;
}
