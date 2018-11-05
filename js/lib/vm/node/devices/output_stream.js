const DataStruct = require('data_struct.js');
const RAM = require('vm/devices/ram.js');
require('vm/types.js');

function OutputStream(stream, mem_size, vm, irq)
{
  mem_size = mem_size || 1024;

  this.stream = stream;
  this.irq = irq;
  this.vm = vm;
  
  this.data_struct = new DataStruct([
    [ 'buffer', mem_size, VM.TYPES.UBYTE ],
    [ 'flush', VM.TYPES.ULONG ]
  ]);
  this.ram = new RAM(this.data_struct.byte_size);
  this.data = this.data_struct.proxy(this.ram.data_view());
  /*
  // Fixme events aren't being fired in node. Forget if they're used in the browser.
  var self = this;
  this.data.addEventListener(function(e) {
    console.log("Console data", e);
    if(e.detail.view == self.view) {
      if(e.detail.fields['flush'] != null) {
        self.flush();
      }
    }
  });
  */
}

OutputStream.prototype.ram_size = function()
{
  return this.ram.length;
}

OutputStream.prototype.flush = function()
{
  var self = this;
  this.stream.write(String.fromCharCode.apply(null, this.data.buffer.slice(0, this.data.flush)),
                    null,
                    function() {
                      if(self.data.flush > 0) {
                        if(self.irq) self.vm.interrupt(self.irq);
                      }
                      self.ram.set(0, self.ram.length, 0);
                    });
}

OutputStream.prototype.read = function(addr, count, output, offset)
{
    return this.ram.read(addr, count, output, offset);
}

OutputStream.prototype.write = function(addr, data)
{
  this.ram.write(addr, data);
  if(addr == this.data.ds.fields['flush'].offset && this.data.flush > 0) {
    this.flush();
  }
}

OutputStream.prototype.step = function()
{
  /*
  if(this.data.flush > 0) {
    this.flush();
  }
*/
}

if(typeof(module) != 'undefined') {
  module.exports = OutputStream;
}
