const DataStruct = require('data_struct.js');
const RAM = require('vm/devices/ram.js');
const RingBuffer = require('vm/ring_buffer.js');
require('vm/types.js');

function InputStream(stream, mem_size, vm, irq)
{
  mem_size = mem_size || 1024;

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
    this.stream.pause();

    var self = this;
    this.stream.on('close', function() {
      self.data.eos = 1;
      self.trigger_interrupt();
    });
  
    this.stream.on('readable', function() {
      if(self.data.ready == 0) {
        self.read_more();
      }
    });
  }
}

InputStream.prototype.trigger_interrupt = function()
{
  if(this.irq) {
    this.vm.interrupt(this.irq);
  }
}

InputStream.prototype.read_more = function()
{
  var data = process.stdin.read(this.data.buffer.length);
  if(this.debug) {
    console.log("InputStream", this.data.eos, this.data.ready, "Read ", data);
  }

  if(data == null) {
    this.data.ready = 0;
  } else {
    for(var i = 0; i < data.length; i++) {
      this.data.buffer[i] = data[i];
    }

    this.data.ready = data.length;
    this.data.eos = 0;

    this.trigger_interrupt();
  }
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

InputStream.prototype.write = function(addr, data)
{
  this.ram.write(addr, data);
  if(addr == this.data.ds.fields['ready'].offset && this.data.ready == 0) {
    this.read_more();
  }
}

InputStream.prototype.step = function()
{
  return false;
}

if(typeof(module) != 'undefined') {
  module.exports = InputStream;
}
