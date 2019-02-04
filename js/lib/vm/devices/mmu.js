"use strict";

const RangedHash = require('vm/ranged_hash.js');
const PagedHash = require('paged_hash.js');

if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
    VM = {};
}

VM.MMU = function()
{
  this.name = "MMU";
  this.memory_map = new PagedHash();
}

VM.MMU.NotMappedError = function(addr)
{
  this.msg = "Address not mapped: " + addr;
  this.addr = addr;
}

VM.MMU.prototype.step = function()
{
  return false;
}

VM.MMU.prototype.map_memory = function(addr, size, responder)
{
    this.memory_map.add(addr, size, responder);
    return this;
}

VM.MMU.prototype.start_address_for = function(dev)
{
  var range = this.memory_map.range_for(dev);
  if(range) {
    return range.addr;
  }
}

VM.MMU.prototype.memread = function(addr, count)
{
    if(this.debug) console.log("MMU read", addr, typeof(count) == 'number', count);
    
    if(typeof(count) == "number") {
        var buffer = new Uint8Array(count);
        var a;
        for(var offset = 0; offset < count; offset++) {
            a = addr + offset;
          //var mem = this.memory_map.gete(a);
          //var inc = mem.value.read(a - mem.start, count, buffer, offset);
          var mem = this.memory_map.get(a);
          if(mem == null) throw new VM.MMU.NotMappedError(addr);
            var inc = mem.value.read(a - mem.addr, count, buffer, offset);
            if(inc == 0) break;
            offset += inc - 1;
        }
        return buffer;
    } else {
        var type = count;
        if(type == null) type = VM.TYPES.ULONG;
        else if(typeof(type) == 'string') type = VM.TYPES[count];
        
        var b = this.memread(addr, type.byte_size);
        var dv = new DataView(b.buffer, b.byteOffset);
        return type.get(dv, 0, true);
    }
}

VM.MMU.prototype.memread1 = function(addr, type)
{
  var mem = this.memory_map.get(addr);
  if(mem == null) throw new VM.MMU.NotMappedError(addr);
  
  var real_addr = addr - mem.addr;
  if(real_addr < (mem.size - type.byte_size)) {
    return mem.value.read1(real_addr, type);
  } else {
    var out = this.memread(addr, type.byte_size);
    var dv = new DataView(out.buffer, out.byteOffset);
    return type.get(dv, 0, true);
  }
}

VM.MMU.prototype.memreadl = function(addr)
{
    return this.memread1(addr, VM.TYPES.LONG);
}

VM.MMU.prototype.memreadL = function(addr)
{
    return this.memread1(addr, VM.TYPES.ULONG);
}

VM.MMU.prototype.memreadS = function(addr)
{
    return this.memread1(addr, VM.TYPES.USHORT);
}

VM.MMU.prototype.memwrite = function(addr, data, type)
{
    if(type) {
        var b = new Uint8Array(type.byte_size);
        var dv = new DataView(b.buffer, b.byteOffset);
        type.set(dv, 0, data, true);
	      return this.memwrite(addr, b);
    } else {
        var a, offset;
        for(offset = 0; offset < data.length; offset++) {
            a = addr + offset;
          //var mem = this.memory_map.gete(a);
          //var inc = mem.value.write(a - mem.start, data.slice(offset));
            var mem = this.memory_map.get(a);
            if(mem == null) throw new VM.MMU.NotMappedError(addr);
            var inc = mem.value.write(a - mem.addr, data.slice(offset));
            if(inc == 0) {
                break;
            }
            offset += inc - 1; // double inc w/o - 1
        }
        
        return offset;
    }
}

VM.MMU.prototype.memwrite1 = function(addr, value, type)
{
  var mem = this.memory_map.get(addr);
  if(mem == null) throw new VM.MMU.NotMappedError(addr);

  var real_addr = addr - mem.addr;
  if(real_addr < (mem.size - type.byte_size)) {
    return mem.value.write1(real_addr, value, type);
  } else {
    var bytes = new Uint8Array(type.byte_size);
    var dv = new DataView(bytes.buffer);
    type.set(dv, 0, value, true);
    return this.memwrite(addr, bytes);
  }
}

VM.MMU.prototype.memwritel = function(addr, n)
{
    return this.memwrite1(addr, n, VM.TYPES.LONG);
}

VM.MMU.prototype.memwriteL = function(addr, n)
{
    return this.memwrite1(addr, n, VM.TYPES.ULONG);
}

VM.MMU.prototype.memwrites = function(addr, n)
{
    return this.memwrite1(addr, n, VM.TYPES.SHORT);
}

VM.MMU.prototype.memwriteS = function(addr, n)
{
    return this.memwrite1(addr, n, VM.TYPES.USHORT);
}

VM.MMU.prototype.save_state = function()
{
  var memories = [];

  this.memory_map.map(function(m, n) {
    memories[m.id] = {
      addr: m.addr,
      size: m.size,
      value: m.value['save_state'] ? m.value.save_state() : null
    };
  });
  
  return {
    memories: memories
  };
}

VM.MMU.prototype.restore_state = function(state)
{
  if(state['memories']) {
    for(var i = 0; i < state.memories.length; i++) {
      var m = state.memories[i];
      var mem = this.memory_map.get(m.addr);
      if(m.value
         && mem.size == m.size
         && mem.value
         && mem.value['restore_state']) {
        mem.value.restore_state(m.value);
      }
    }
  }
}

VM.MMU.test_suite = function()
{
  const RAM = require('vm/devices/ram');
  const assert = require('asserts.js');

  var mmu = new VM.MMU();
  var size = PagedHash.PageSize;
  mmu.map_memory(0, size, new RAM(size));
  mmu.map_memory(size, size, new RAM(size));

  // read/write
  assert.assert(mmu.memwrite(0, [ 1, 2, 3, 4 ]) == 4, 'returns number bytes writen');
  assert.assert(mmu.memread(0, 4).toString() == [ 1, 2, 3, 4 ].toString(), 'reads the bytes that were writen');
  
  // read and write at a divide
  assert.assert(mmu.memwrite(size - 2, [ 1, 2, 3, 4]) == 4, 'returns number of bytes writen');
  assert.assert(mmu.memread(size - 2, 4).toString() == [ 1, 2, 3, 4 ].toString(), 'reads the bytes that were writen');

  // integers at the divide
  for(var offset = 0; offset < 4; offset++) {
    mmu.memwriteL(size - offset, 0x12345678);
    assert.assert(mmu.memreadL(size - offset) == 0x12345678, 'reads the integer that was writen offset by ' + offset);
    assert.assert(mmu.memreadS(size - offset + 1) == 0x3456, 'reads shorts');
  }
  
  return mmu;
}
