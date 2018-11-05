function RAM(amount)
{
    if(typeof(amount) == 'number') {
        this.length = amount;
        this._data = new Uint8Array(amount);
    } else {
        this._data = amount;
        this.length = amount.length;
    }
}

RAM.prototype.data_view = function(offset)
{
    return new DataView(this._data.buffer, this._data.byteOffset + (offset || 0));
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

if(typeof(module) != 'undefined') {
  module.exports = RAM;
}
