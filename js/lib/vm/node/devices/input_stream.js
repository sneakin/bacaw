"use strict";

const DataStruct = require('data_struct.js');
const Enum = require('enum.js');
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
    [ 'interrupt_on', VM.TYPES.ULONG ],
    [ 'buffer', mem_size, VM.TYPES.UBYTE ],
    [ 'terminator', VM.TYPES.ULONG ] // provides a null terminator and pads reads of the last 3 bytes
  ]);
  this.ram = new RAM(this.data_struct.byte_size);
  this.data = this.data_struct.proxy(this.ram.data_view());
  this.reset();

  if(this.stream) {
    this.stream.pause();

    var self = this;
    var on_close = function() {
      self.data.eos = 1;
      if(self.interrupt_on_events()) self.trigger_interrupt();
    };
    this.stream.on('close', on_close);
    this.stream.on('end', on_close);
  
    /*
    this.stream.on('readable', function() {
      self.data.eos = 0;
      if(self.interrupt_on_events()) self.trigger_interrupt();
      //self.read_more(self.stream.read(mem_size));
    });
    */

    this.stream.on('data', function(data) {
      self.read_more(data);
    });
  }
}

InputStream.InterruptMode = new Enum([
  [ 'Never', 0 ],
  [ 'Lines', 1 ],
  [ 'Bytes', 2 ],
  [ 'Events', 4 ]
]);

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
    console.debug("InputStream", data && data.length, this.data.eos, this.data.ready, this.data.interrupt_on, "Read ", data,  this.encode(data));
  }

  this.set_data(data);
  if(data == null || data.length == 0) {
    return false;
  }

  if(this.interrupt_on_data()) {
    this.trigger_interrupt();
  }
  return this;
}

InputStream.prototype.ram_size = function()
{
  return this.ram.length;
}

InputStream.prototype.reset = function()
{
  this.ram.set(0, this.ram.length, 0);
  this.data.interrupt_on = InputStream.InterruptMode.Lines | InputStream.InterruptMode.Events;
  this.update_mode();
}

InputStream.prototype.read = function(addr, count, output, offset)
{
    return this.ram.read(addr, count, output, offset);
}

InputStream.prototype.write = function(addr, data)
{
  this.ram.write(addr, data);
  switch(addr) {
  case this.data.ds.fields['ready'].offset:
    if(this.data.ready == 0) {
      this.stream.resume();
    }
    break;
    // fixme: middle of a ULONG?
  case this.data.ds.fields['interrupt_on'].offset:
    this.update_mode();
    break;
  }
}

InputStream.prototype.step = function()
{
  return false;
}

InputStream.prototype.update_mode = function()
{
  if(this.stream.setRawMode) {
    if(this.interrupt_on_bytes() != this.stream.isRaw) {
      this.stream.setRawMode(this.interrupt_on_bytes());
    }
  }
}

InputStream.prototype.interrupt_on_events = function()
{
  return (this.data.interrupt_on & InputStream.InterruptMode.Events) != 0;
}

InputStream.prototype.interrupt_on_data = function()
{
  return (this.data.interrupt_on & InputStream.InterruptMode.Bytes) != 0
      || (this.data.interrupt_on & InputStream.InterruptMode.Lines) != 0;
}

InputStream.prototype.interrupt_on_bytes = function()
{
  return (this.data.interrupt_on & InputStream.InterruptMode.Bytes) != 0;
}

if(typeof(module) != 'undefined') {
  module.exports = InputStream;
}
