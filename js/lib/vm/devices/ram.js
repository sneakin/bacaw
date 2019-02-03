function RAM(amount)
{
    if(typeof(amount) == 'number') {
        this.set_data(new Uint8Array(amount));
    } else {
        this.set_data(amount);
    }
}

RAM.prototype.set_data = function(arr)
{
  this._data = arr;
  this.length = arr.length;
  this._view = this.data_view();
}

RAM.prototype.data_view = function(offset)
{
    return new DataView(this._data.buffer, this._data.byteOffset + (offset || 0));
}

RAM.prototype.read1 = function(addr, type)
{
    if(type == null) type = VM.TYPES.ULONG;
    else if(typeof(type) == 'string') type = VM.TYPES[count];

    return type.get(this._view, addr, true);
}

RAM.prototype.write1 = function(addr, value, type)
{
    if(type == null) type = VM.TYPES.ULONG;
    else if(typeof(type) == 'string') type = VM.TYPES[count];

    type.set(this._view, addr, value, true);
    return addr + type.byte_size;
}

RAM.prototype.read = function(addr, count, output, offset)
{
    if(output) {
        var i;
        for(i = 0; i < count; i++) {
            if(addr + i >= this._data.length) {
                break;
            }
            output[offset + i] = this._data[addr + i];
        }
        return i;
    } else {
		    return this._data.subarray(addr, addr + count);
    }
}

RAM.prototype.write = function(addr, data)
{
    if(data.length == null) data = [ data ];
    
    var i;
	  for(i = 0; i < data.length; i++) {
        if(addr + i >= this._data.length) {
            break;
        }
		    this._data[addr + i] = data[i];
	  }
	  return i;
}

RAM.prototype.set = function(addr, count, value)
{
    for(var i = 0; i < count; i++) {
        this.write(addr + i, value);
    }
}

RAM.prototype.step = function()
{
  return false;
}

RAM.prototype.save_state = function()
{
  return {
    length: this.length,
    memory: this.read(0, this.length)
  };
}

RAM.prototype.restore_state = function(state)
{
  if(state['memory']) {
    this.set_data(new Uint8Array(state.memory));
  } else if(state['length']) {
    this.set_data(new Uint8Array(state.length));
  }
}

var RAM_TYPE_ACCESSORS = [
    [ "f", "Float32" ],
    [ "l", "Int32" ],
    [ "L", "Uint32" ],
    [ "s", "Int16" ],
    [ "S", "Uint16" ]
];

for(var i = 0; i < RAM_TYPE_ACCESSORS.length; i++) {
    var a = RAM_TYPE_ACCESSORS[i];
    
    var x = function(sym, type) {
        var type_array = eval(type + "Array");
        RAM.prototype["read" + sym] = function(addr, count, endian) {
            var bytes = this.read(addr, type_array.BYTES_PER_ELEMENT * count);
            var dv = new DataView(bytes.buffer, bytes.byteOffset);
            var result = [];
            for(var i = 0; i < count; i++) {
                result[i] = dv["get" + type](i * type_array.BYTES_PER_ELEMENT, endian || true);
            }
            return result;
        }

        RAM.prototype["write" + sym] = function(addr, data, endian) {
            var bytes = new Uint8Array(data.length * type_array.BYTES_PER_ELEMENT);
            var dv = new DataView(this._data.buffer, this._data.byteOffset + addr);

            for(var i = 0; i < data.length; i++) {
                dv["set" + type](i * type_array.BYTES_PER_ELEMENT, data[i], endian || true);
            }
            return this;
        }
    };

    x(a[0], a[1]);
}

if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
  VM = {};
}
if(typeof(VM.Devices) == 'undefined') {
  VM.Devices = {};
}
VM.Devices.RAM = RAM;

if(typeof(module) != 'undefined') {
  module.exports = RAM;
}
