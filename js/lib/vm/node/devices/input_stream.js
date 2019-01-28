"use strict";

const DataStruct = require('data_struct.js');
const RAM = require('vm/devices/ram.js');
const RingBuffer = require('vm/ring_buffer.js');
require('vm/types.js');

function InputStream(stream, mem_size, vm, irq)
{
  mem_size = mem_size || 1024;

  this.name = "InputStream";
  this.vm = vm;
  this.stream = stream;
  this.irq = irq;
  
  this.data_struct = new DataStruct([
    [ 'ready', VM.TYPES.ULONG ],
    [ 'eos', VM.TYPES.ULONG ],
    [ 'buffer', mem_size, VM.TYPES.UBYTE ],
    [ 'terminator', VM.TYPES.ULONG ] // provides a null terminator and pads reads of the last 3 bytes
  ]);
  this.ram = new RAM(this.data_struct.byte_size);
  this.data = this.data_struct.proxy(this.ram.data_view());
  this.reset();

  if(this.stream) {
    //this.stream.pause();

    var self = this;
    this.stream.on('close', function() {
      self.data.eos = 1;
      self.trigger_interrupt();
    });
  
    this.stream.on('readable', function() {
      self.data.eos = 0;
      self.trigger_interrupt();
    });

    this.stream.on('data', function(data) {
      self.read_more(data);
    });
  }
}

InputStream.prototype.trigger_interrupt = function()
{
  if(this.irq) {
    this.vm.interrupt(this.irq);
  }
}

InputStream.prototype.read_more = function(data)
{
  /*
    var len = this.data.buffer.length;
    if(this.stream._readableState) len = Math.min(this.stream._readableState.length, len);
    if(this.stream.readableLength) len = Math.min(this.stream.readableLength(), len);
    
  var data = this.stream.read(Math.max(len, 1));
*/
  this.stream.pause();

  if(this.debug) {
    console.log("InputStream", data && data.length, this.data.eos, this.data.ready, "Read ", data);
  }

  if(data && data.length > 0) {
    if(typeof(data) == 'string') {
      for(var i = 0; i < data.length; i++) {
        this.data.buffer[i] = data.charCodeAt(i);
      }
      this.data.buffer.fill(0, data.length);
    } else {
      this.data.buffer.set(data);
      this.data.buffer.fill(0, data.length);
    }    
  } else {
    this.data.buffer.fill(0);
    this.data.ready = 0;
    return false;
  }
  
    this.data.ready = data.length;
    this.data.eos = 0;

    this.trigger_interrupt();
    return this;
}

InputStream.prototype.ram_size = function()
{
  return this.ram.length;
}

InputStream.prototype.reset = function()
{
  this.data.ready = 0;
  this.data.eos = 0;
  this.data.terminator = 0;
  this.ram.set(0, this.ram.length, 0);
}

InputStream.prototype.read = function(addr, count, output, offset)
{
    return this.ram.read(addr, count, output, offset);
}

InputStream.prototype.read1 = function(addr, type)
{
    return this.ram.read1(addr, type);
}

InputStream.prototype.write = function(addr, data)
{
  this.ram.write(addr, data);
  if(addr == this.data.ds.fields['ready'].offset && this.data.ready == 0) {
    this.stream.resume();
  }
}

InputStream.prototype.write1 = function(addr, value, type)
{
    this.ram.write1(addr, value, type);
    if(addr == this.data.ds.fields['ready'].offset && this.data.ready == 0) {
      this.stream.resume();
    }
}

InputStream.prototype.step = function()
{
  return false;
}

if(typeof(module) != 'undefined') {
  module.exports = InputStream;
}
