const DataStruct = require('data_struct.js');
const RAM = require('vm/devices/ram.js');
require('vm/types.js');

function Console(mem_size)
{
    mem_size = mem_size || 1024;

    this.name = "Console";
    this.data_struct = new DataStruct([
        [ 'buffer', mem_size, VM.TYPES.UBYTE ],
        [ 'flush', VM.TYPES.ULONG ]
    ]);
    this.ram = new RAM(this.data_struct.byte_size);
  this.data = this.data_struct.proxy(this.ram.data_view());
  this.callbacks = [ function(str) { console.log(str); } ];
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

Console.prototype.add_callback = function(cb)
{
  this.callbacks.push(cb);
  return this;
}

Console.prototype.flush = function()
{
  var str = String.fromCharCode.apply(null, this.data.buffer.slice(0, this.data.flush)).trim();
  for(var i in this.callbacks) {
    this.callbacks[i](str);
  }
  this.ram.set(0, this.ram.length, 0);
}

Console.prototype.read = function(addr, count, output, offset)
{
    return this.ram.read(addr, count, output, offset);
}

Console.prototype.read1 = function(addr, type)
{
    return this.ram.read1(addr, type);
}

Console.prototype.write = function(addr, data)
{
  this.ram.write(addr, data);
  if(addr == this.data.ds.fields['flush'].offset) {
    this.flush();
  }
}

Console.prototype.write1 = function(addr, type)
{
    var n = this.ram.write1(addr, type);
    if(addr == this.data.ds.fields['flush'].offset) {
        this.flush();
    }
    return n;
}

Console.prototype.step = function(s)
{
  return false;
}

if(typeof(module) != 'undefined') {
	module.exports = Console;
}
