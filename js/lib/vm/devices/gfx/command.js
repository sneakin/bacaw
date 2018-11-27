Command = function(name, arglist)
{
    this.name = name;
    this.arglist = arglist;
    this.arity = arglist.length;
}

Command.ArgumentError = "ArgumentError";

Command.prototype.encode_array = function(args, dv)
{
    if(args.length != this.arity) {
        throw Command.ArgumentError;
    }

    var bi = 0;
    for(var i = 0; i < this.arity; i++) {
        switch(this.arglist[i]) {
        case 'b':
            dv.setInt8(bi, args[i]);
            bi += Int8Array.BYTES_PER_ELEMENT;
            break;
        case 'B':
            dv.setUint8(bi, args[i]);
            bi += Uint8Array.BYTES_PER_ELEMENT;
            break;
        case 'f':
            dv.setFloat32(bi, args[i], true);
            bi += Float32Array.BYTES_PER_ELEMENT;
            break;
        case 'l':
            dv.setInt32(bi, args[i], true);
            bi += Int32Array.BYTES_PER_ELEMENT;
            break;
        case 'L':
            dv.setUint32(bi, args[i], true);
            bi += Uint32Array.BYTES_PER_ELEMENT;
            break;
        default:
            throw "Unkown arglist specifier";
        }
    }

    return bi;
}

if(typeof(module) != 'undefined') {
    module.exports = Command;
}