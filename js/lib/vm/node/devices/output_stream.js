"use strict";

const Enum = require('enum.js');
const DataStruct = require('data_struct.js');
const RAM = require('vm/devices/ram.js');
require('vm/types.js');

const TextDecoder = require('util/text_decoder');

function OutputStream(stream, mem_size, irq)
{
  mem_size = mem_size || 1024;

  this.name = "OutputStream";
  this.stream = stream;
  this.irq = irq;
  this.data_struct = new DataStruct([
    [ 'eos', VM.TYPES.ULONG ],
    [ 'cmd', VM.TYPES.ULONG ],
    [ 'buffer', mem_size, VM.TYPES.UBYTE ],
    [ 'flush', VM.TYPES.ULONG ]
  ]);
  this.ram = new RAM(this.data_struct.byte_size);
  this.data = this.data_struct.proxy(this.ram.data_view());

  if(this.stream) {
    var self = this;
    this.stream.on('close', function() {
      self.set_eos(OutputStream.EOSStates.CLOSED);
    });
    this.stream.on('error', function() {
      self.set_eos(OutputStream.EOSStates.ERROR);
    });
    this.stream.on('drain', function() {
      self.set_eos(OutputStream.EOSStates.OK);
    });
  }
}

OutputStream.EOSStates = new Enum([
  "OK",
  "CLOSED",
  "ERROR",
  "FULL"
]);

OutputStream.prototype.trigger_interrupt = function()
{
  this.irq.trigger();
}

OutputStream.prototype.set_eos = function(state)
{
  if(this.debug) console.log("OutputStream set EOS", state);
  this.data.eos = state;
  this.trigger_interrupt();
}

OutputStream.prototype.ram_size = function()
{
  return this.ram.length;
}

OutputStream.prototype.decode = function(bytes)
{
  if(this.decoder == null) {
    this.decoder = new TextDecoder();
  }
  return this.decoder.decode(bytes, { stream: true });
}

OutputStream.prototype.flush = function()
{
  var self = this;
  var bytes = this.data.buffer.slice(0, this.data.flush);
  // node doesn't always like Uint8Array's
  if(typeof(Buffer) != 'undefined') {
    bytes = Buffer.from(bytes);
  }
  var r = this.stream.write(bytes,
                            null,
                            function() {
                              if(self.data.flush > 0) {
                                if(self.debug) console.log("OutputStream flushed", bytes);
                                self.data.eos = OutputStream.EOSStates.OK;
                                self.ram.set(0, self.ram.length, 0);
                                self.trigger_interrupt();
                              }
                            });
  if(r == false) {
    if(this.debug) console.log("OutputStream write returned false");
    this.data.eos = OutputStream.EOSStates.FULL;
    this.trigger_interrupt();
  }
}

OutputStream.prototype.read = function(addr, count, output, offset)
{
    return this.ram.read(addr, count, output, offset);
}

OutputStream.prototype.write = function(addr, data)
{
  var n = this.ram.write(addr, data);
  if(addr == this.data.ds.fields['flush'].offset && this.data.flush > 0) {
    this.flush();
  } else if(addr == this.data.ds.fields['cmd'].offset) {
    this.process_cmd();
  }

  return n;
}

OutputStream.prototype.process_cmd = function()
{
  switch(this.data.cmd) {
  case 1:
    this.stream.end();
    break;
  default:
    break;
  }

  this.data.cmd = 0;
  return this;
}

OutputStream.prototype.step = function()
{
  /*
  if(this.data.flush > 0) {
    this.flush();
  }
*/

  return false;
}

if(typeof(module) != 'undefined') {
  module.exports = OutputStream;
}
