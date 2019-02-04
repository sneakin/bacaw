require('vm.js');
const util = require('util.js');

function Assembler_Impl(vm)
{
  this.vm = vm;
  this.calls = [];
  this.labels = new Map;
  this._ip = 0;
}

Assembler_Impl.prototype.call_op = function(proxy, op, args)
{
    if(op == 'times') {
        for(var i = 0; i < args[0]; i++) {
            args[1](proxy, i);
        }
    } else {
        this.calls.push([ op ].concat(args));
        switch(op) {
        case 'float32':
        case 'int32':
        case 'uint32':
        case 'addr':
            this._ip += VM.CPU.REGISTER_SIZE;
            break;
        case 'bytes':
            var inc = args[0].length;
            this._ip += Math.ceil(inc / VM.CPU.INSTRUCTION_SIZE) * VM.CPU.INSTRUCTION_SIZE; // align to instruction size
          break;
        default:
            this._ip += VM.CPU.INSTRUCTION_SIZE;
        }
    }

    return this;
}

Assembler_Impl.prototype.assemble_to_array = function()
{
    /*
    var self = this;
    return flattenDeep(map_each_n(this.calls, function(op_call, n) {
        return self.encode_call_args(vm, op_call, n);
    }));
    */
    var arr = [];
    for(var i = 0; i < this.calls.length; i++) {
        var ins = this.encode_call_args(this.vm, this.calls[i], i, arr.length * VM.CPU.INSTRUCTION_SIZE);
        arr = arr.concat(ins);
    }

    return arr;
}

Assembler_Impl.prototype.assemble = function()
{
    var shorts = Uint16Array.from(this.assemble_to_array());
    var shorts_dv = new DataView(shorts.buffer, shorts.byteOffset);
    for(var i = 0; i < shorts.length; i++) {
        shorts_dv.setUint16(i*2, shorts[i], true);
    }
    return new Uint8Array(shorts.buffer, shorts.byteOffset);
}

Assembler_Impl.prototype.encode_call_args = function(vm, op_call, n, ip)
{
    if(op_call[0] == 'int32' || op_call[0] == 'uint32' || op_call[0] == 'addr') {
        if(typeof(op_call[1]) == 'string') {
            var value = this.resolve(op_call[1]);
            if(op_call[2]) { // relative
                value -= ip;
            }
            if(typeof(op_call[3]) == 'function') {
              value = op_call[3](value);
            }
            return [ value & 0xFFFF, value >> 16 ];
        } else {
            return [ op_call[1] & 0xFFFF, op_call[1] >> 16 ];
        }
    } else if(op_call[0] == 'float32') {
        var sb = new Uint16Array(VM.TYPES.FLOAT.byte_size / VM.TYPES.SHORT.byte_size);
        var dv = new DataView(sb.buffer);
        VM.TYPES.FLOAT.set(dv, 0, op_call[1]);
        return Array.from(sb);
    } else if(op_call[0] == 'bytes') {
        var src = op_call[1];
        var sa = new Uint16Array(Math.ceil(src.length / VM.CPU.INSTRUCTION_SIZE));
      var bytes = new Uint8Array(sa.buffer);
      if(typeof(src) == 'string') {
        for(var i = 0; i < src.length; i++) {
          bytes[i] = src.charCodeAt(i);
        }
      } else {
        for(var i = 0; i < src.length; i++) {
            bytes[i] = src[i];
        }
      }
        return Array.from(sa);
    } else {
        var op_code = VM.CPU.INS[op_call[0].toUpperCase()];
        var ins = VM.CPU.INS_INST[op_code];
        if(!ins) { throw "Unknown op code " + op_call; }
        
        var self = this;
        op_call = util.map_each_n(op_call.slice(1), function(arg, arg_n) {
            if(typeof(arg) == 'string') {
                return self.resolve(arg) || register_index(arg);
            } else {
                return arg;
            }
        });
        var list = ins.encoder_list(op_call);
        return VM.CPU.encode(list);
    }
}

Assembler_Impl.prototype.label = function(name, value)
{
    if(value == null) value = this.ip();
    this.labels[name] = value;
    return this;
}

Assembler_Impl.UnknownKeyError = function(label)
{
    this.msg = "Unknown key";
    this.label = label;
}
Assembler_Impl.UnknownKeyError.prototype.toString = function()
{
  return this.msg + ": " + this.label;
}

Assembler_Impl.prototype.resolve = function(label, relative)
{
  if(this.labels[label] == null) {
        throw new Assembler_Impl.UnknownKeyError(label);
    }

    if(relative == true) {
        return this.labels[label] - this.ip();
    } else {
        return this.labels[label];
    }
}

Assembler_Impl.prototype.ip = function()
{
    return this._ip;
}

var Assembler_Proxy = {
    get: function(impl, prop) {
        if(typeof(impl[prop]) == 'function') {
            return function() {
                var r = impl[prop].apply(impl, arguments);
                if(r == impl) return this;
                else return r;
            }
        } else if(prop == 'labels') {
            return impl.labels;
        } else if(prop == 'calls') {
            return impl.calls;
        } else if(prop == '_target') {
            return impl;
        } else {
            return function() {
                impl.call_op(this, prop, Array.from(arguments))
                return this;
            }
        }
    }
};

function Assembler(vm)
{
  if(!vm && typeof(window) != 'undefined') {
    vm = window.vm;
  }

  var asm = new Assembler_Impl(vm);
  
  return new Proxy(asm, Assembler_Proxy);
}

if(typeof(module) != 'undefined') {
	module.exports = Assembler;
}
