const DataStruct = require('data_struct.js');
const RAM = require('vm/devices/ram.js');
require('vm/types.js');

function Console(mem_size)
{
    mem_size = mem_size || 1024;
    
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
        if(e.detail.view == self.view) {
            if(e.detail.fields['flush'] != null) {
                self.flush();
            }
        }
    });
    */
}

Console.prototype.ram_size = function()
{
  return this.ram.length;
}

Console.prototype.flush = function()
{
  console.log(String.fromCharCode.apply(null, this.data.buffer.slice(0, this.data.flush)).trim());
  this.ram.set(0, this.ram.length, 0);
}

Console.prototype.read = function(addr, count, output, offset)
{
    return this.ram.read(addr, count, output, offset);
}

Console.prototype.write = function(addr, data)
{
  this.ram.write(addr, data);
  if(addr == this.data.ds.fields['flush'].offset) {
    this.flush();
  }
}

Console.prototype.step = function()
{
}

if(typeof(module) != 'undefined') {
	module.exports = Console;
}

