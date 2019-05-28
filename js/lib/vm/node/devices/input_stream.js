"use strict";

const DataStruct = require('data_struct.js');
const RAM = require('vm/devices/ram.js');
const RingBuffer = require('vm/ring_buffer.js');
require('vm/types.js');

const TextEncoder = require('util/text_encoder');

function InputStream(stream, mem_size, irq)
{
  mem_size = mem_size || 1024;

  this.name = "InputStream";
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
  this.irq.trigger();
}

InputStream.prototype.encode = function(data)
{
  if(this.encoder == null) {
    this.encoder = new TextEncoder();
  }
      
  return this.encoder.encode(data, { stream: true });
}

InputStream.prototype.set_data = function(data)
{
  if(data && data.length > 0) {
    var length = data.length;
    
    if(typeof(data) == 'string') {
      var bytes = this.encode(data);
      this.data.buffer.set(bytes);
      length = bytes.length;
    } else {
      this.data.buffer.set(data);
    }    
  
    this.data.buffer.fill(0, length);
    this.data.ready = length;
    this.data.eos = 0;
  } else {
    this.data.buffer.fill(0);
    this.data.ready = 0;
  }
}

InputStream.prototype.read_more = function(data)
{
  this.stream.pause();

  if(this.debug) {
    console.log("InputStream", data && data.length, this.data.eos, this.data.ready, "Read ", data,  this.encode(data));
  }

  this.set_data(data);
  if(data == null || data.length == 0) {
    return false;
  }
  
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
