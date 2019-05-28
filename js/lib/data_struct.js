"use strict";

const util = require('util.js');

function DataStruct(fields, little_endian, alignment)
{
    this.fields = new Map();
    this.num_fields = 0;
    this.endianess = little_endian || true;
    this.alignment = alignment || 1;
    var offset = 0;
    for(var n in fields) {
        var f = new DataStruct.Field(fields[n], n, offset);
      offset += f.byte_size;
      offset = this.align(offset);
        this.fields[f.name] = f;
        this.fields[n] = f;
        this.num_fields++;
    }
    this.byte_size = offset;
}

DataStruct.prototype.align = function(bytes)
{
  return Math.ceil(bytes / this.alignment) * this.alignment;
}

DataStruct.prototype.field_at_offset = function(offset)
{
    for(var i = 0; i < this.num_fields; i++) {
        var field = this.fields[i];
        if(offset >= field.offset && offset < (field.offset + field.byte_size)) {
            return field;
        }
    }

    return null;
}

DataStruct.prototype.fields_spanning = function(offset, num_bytes)
{
    var fields = [];
    for(var i = 0; i < this.num_fields; i++) {
        var field = this.fields[i];
        if(field.offset >= offset && field.offset < (offset + num_bytes)) {
            fields.push(field);
        } else if(field.offset >= (offset + num_bytes)) {
            break;
        }
    }
    return fields;
}

DataStruct.prototype.allocate = function(dv)
{
    if(dv == null) {
        var ab = new ArrayBuffer(this.byte_size);
        dv = new DataView(ab);
    }
    return this.proxy(dv);
}

DataStruct.prototype.get = function(dv, offset)
{
    dv = new DataView(dv.buffer, dv.byteOffset + offset);
    return this.allocate(dv);
}

DataStruct.prototype[Symbol.iterator] = function*()
{
    for(var i = 0; i < this.num_fields; i++) {
        yield(this.fields[i].name);
    }
}


DataStruct.Field = function(field_def, number, offset)
{
    this.name = field_def[0];
    this.id = parseInt(number);
    if(typeof(field_def[1]) == 'number') {
        this.elements = field_def[1];
        this.type = field_def[2];
        this.default_value = field_def[3];
        if(VM.TYPES[this.type.name] != this.type) {
            this.struct = true;
        }
    } else {
        this.elements = null;
        this.type = field_def[1];
        this.default_value = field_def[2];
    }
    this.offset = offset;
    this.byte_size = this.type.byte_size * (this.elements || 1);
}

DataStruct.View = function(ds, dv)
{
    this.ds = ds;
    this.dv = dv;
    this._proxies = [];
}

DataStruct.View.prototype.get_array = function(field)
{
    if(field.struct) {
        if(!this._proxies[field.id]) {
            var self = this;
            this._proxies[field.id] = util.n_times(field.elements, function(n) {
                return field.type.proxy(new DataView(self.dv.buffer,
                                                     self.dv.byteOffset
                                                     + field.offset
                                                     + field.type.byte_size * n
                                                    ));
            });
        }
        return this._proxies[field.id];
    } else {
        return field.type.proxy(this.dv.buffer, this.dv.byteOffset + field.offset, field.elements);
    }
}

DataStruct.View.prototype.get = function(field)
{
    var f = this.ds.fields[field];
    if(f) {
        if(f.elements != null) {
            return this.get_array(f);
        } else if(f.type != null) {
            return f.type.get(this.dv, f.offset, this.ds.endianess);
        }
    }

    return null;
}

DataStruct.View.prototype.set = function(field, value)
{
    var f = this.ds.fields[field];
    var r = f.type.set(this.dv, f.offset, value, this.ds.endianess);
    return r;
}

DataStruct.View.prototype.read = function(offset, count, output)
{
    var arr = new Uint8Array(this.dv.buffer, this.dv.byteOffset);
    if(output) {
        var i;
        for(i = 0; i < count; i++) {
            if(offset + i >= arr.length) {
                break;
            }
            output[i] = arr[offset + i];
        }
        return i;
    } else {
		    return arr.subarray(offset, offset + count);
    }    
}

DataStruct.View.prototype.write = function(offset, data)
{
    var arr = new Uint8Array(this.dv.buffer, this.dv.byteOffset);
    var i;

    for(i = 0; i < data.length; i++) {
        if(offset + i >= arr.length) {
            break;
        }
		    arr[offset + i] = data[i];
    }

    return i;
}

DataStruct.View.prototype.update_from = function(obj)
{
    for(var field of this) {
        if(obj[field]) {
            this.set(field, obj[field]);
        }
    }

    return this;
}

DataStruct.View.prototype[Symbol.iterator] = function*()
{
    for(var i of this.ds) {
        yield(i);
    }
}

DataStruct.View.prototype.to_object = function()
{
    var o = {};
    for(var f of this) {
        o[f] = this.get(f);
    }
    return o;
}

DataStruct.View.prototype.toString = function()
{
    var fields = [];
    for(var f of this.ds) {
        fields.push(f);
    }
    return "[DataStruct: " + fields.join(", ") + "]";
}

DataStruct.View.Proxy = {
    get: function(view, prop) {
        if(prop == Symbol.iterator || (prop.match && prop.match(/^(read|write|toString|to_object|update_from)$/g) != null)) {
            return function() {
                var r = view[prop].apply(view, arguments);
                if(r === view) {
                    return this;
                } else {
                    return r;
                }
            }
        } else if(prop == 'view') {
            return view;
        } else if(prop.match && prop.match(/^(ds|dv)$/g) != null) {
            return view[prop];
        } else {
            return view.get(prop);
        }
    },
    set: function(view, prop, value) {
        view.set(prop, value);
        return this;
    }
};

DataStruct.prototype.view = function(dv)
{
    return new DataStruct.View(this, dv);
}

DataStruct.prototype.proxy = function(dv)
{
    var view = this.view(dv);
    return new Proxy(view, DataStruct.View.Proxy);
}

if(typeof(module) != 'undefined') {
  module.exports = DataStruct;
}
