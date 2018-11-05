const util = require('util.js');

if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
    VM = {};
}

VM.Type = function(name, id, js_name, min, max)
{
    this.name = name;
    this.id = id;
    this.js_name = js_name;
    this.array = eval(this.js_name + 'Array');
    this.byte_size = this.array.BYTES_PER_ELEMENT;
    this.array_getter = "get" + this.js_name;
    this.array_setter = "set" + this.js_name;
    this.min = min;
    this.max = max;
}

VM.Type.prototype.get = function(dv, offset, endian)
{
    return dv[this.array_getter](offset, endian || true);
}

VM.Type.prototype.set = function(dv, offset, value, endian)
{
    return dv[this.array_setter](offset, value, endian || true);
}

VM.Type.prototype.proxy = function(buffer, offset, length)
{
    return new this.array(buffer, offset, length);
}

VM.TYPE_SIGNED = (1<<3);
const FLOAT32_MAX = 3.402823e+38;
const FLOAT64_MAX = 3.402823e+307;

VM.TYPE_DEFS = {
    LONG: [ VM.TYPE_SIGNED | 0, 'Int32', -0x7FFFFFFF, 0x7FFFFFFF ],
    BYTE: [ VM.TYPE_SIGNED | 1, 'Int8', -0x7F, 0x7F ],
    SHORT: [ VM.TYPE_SIGNED | 2, 'Int16', -0x7FFF, 0x7FFF ],
    FLOAT: [ 4, 'Float32', -FLOAT32_MAX, FLOAT32_MAX ],
    DOUBLE: [ 5, 'Float64', -FLOAT64_MAX, FLOAT64_MAX ],
    ULONG: [ 0, 'Uint32', 0, 0xFFFFFFFF ],
    UBYTE: [ 1, 'Uint8', 0, 0xFF ],
    USHORT: [ 2, 'Uint16', 0, 0xFFFF ],
};

VM.TYPES = util.map_each(VM.TYPE_DEFS, function(name, def) {
    return new VM.Type(name, def[0], def[1], def[2], def[3]);
});
for(var name in VM.TYPES) {
    var t = VM.TYPES[name];
    VM.TYPES[t.id] = t;
}

VM.TYPE_IDS = util.map_each(VM.TYPES, function(name, def) {
    return def.id;
});
VM.TYPE_IDS[VM.TYPE_IDS.FLOAT | VM.TYPE_SIGNED] = VM.TYPE_IDS.FLOAT;
VM.TYPES[VM.TYPE_IDS.FLOAT | VM.TYPE_SIGNED] = VM.TYPES.FLOAT;
VM.TYPE_IDS[VM.TYPE_IDS.DOUBLE | VM.TYPE_SIGNED] = VM.TYPE_IDS.DOUBLE;
VM.TYPES[VM.TYPE_IDS.DOUBLE | VM.TYPE_SIGNED] = VM.TYPES.DOUBLE;
