function DispatchTable(mask, shift, ops)
{
    this.mask = mask;
    this.shift = shift;
    this.max = this.mask >> this.shift;
    this.ops = ops || {};
}

DispatchTable.UnknownKeyError = "Unknown Key";

DispatchTable.prototype.unmask_op = function(op)
{
    return (op & this.mask) >> this.shift;
}

DispatchTable.prototype.mask_op = function(op)
{
    return (op << this.shift) & this.mask;
}

DispatchTable.prototype.set = function(i, value)
{
    this.ops[i] = value;
    return this;
}

DispatchTable.prototype.get = function(op)
{
    var ins = this.ops[this.unmask_op(op)];
    if(ins) return ins;
    else throw DispatchTable.UnknownKeyError;
}

DispatchTable.prototype.find = function(op)
{
    try {
        return this.get(op);
    } catch(e) {
        if(e != DispatchTable.UnknownKeyError) throw(e);
        else return null;
    }
}

DispatchTable.prototype.has = function(op)
{
    try {
        this.get(op);
        return true;
    } catch(e) {
        return false;
    }
}

DispatchTable.prototype.keys = function()
{
    var k = [];
    for(var i in this.ops) {
        i = this.mask_op(parseInt(i));
        if(this.has(i)) k.push(i.toString());
    }
    return k;
}

DispatchTable.prototype.each = function(f)
{
    return this.each_with_index(function(F) { return function(k,v) { return F(v); } }(f));
}

DispatchTable.prototype.each_with_index = function(f)
{
    var r = [];
    for(var i in this.ops) {
        var k = this.mask_op(i);
        var o = this.get(k);
        if(o) r.push(f(k, o));
    }
    return r;
}

DispatchTable.test = function()
{
    var dt = new DispatchTable(0xFF00, 8, {
        15: 'hello',
        32: 'world'
    });
    dt.set(43, 'boo');

    assert(dt.get(15 << 8) == 'hello', "gets the correct value");
    assert(dt.get(32 << 8) == 'world', "gets the correct value");
    assert(dt.get(43 << 8) == 'boo', "gets the correct value");
    assert_throws(function() { dt.get(15); }, DispatchTable.UnknownKeyError, "throws an error for a bad opcode");
    assert_throws(function() { dt.get(31 << 8); }, DispatchTable.UnknownKeyError, "throws an error for a bad opcode");

    var values = [];
    values = dt.each_with_index(function(k, v) {
        return v;
    });
    assert(values.sort().join('') == 'boohelloworld', 'has an each_with_index with values: ' + values.sort().join(''));
    values = dt.each_with_index(function(k, v) {
        return k;
    });
    assert_equal(values.sort(), [ 15<<8, 32<<8, 43<<8 ].sort(), 'has an each_with_index with keys');
    
    var values = [];
    values = dt.each(function(v) {
        return v;
    });
    assert(values.sort().join('') == 'boohelloworld', 'has an each');
    
    return true;
}

function DispatchTableProxy(mask, shift, ops)
{
    return new Proxy(new DispatchTable(mask, shift, ops),
                     {
                         has: function(hash, prop) {
                             return hash.has(parseInt(prop));
                         },
                         ownKeys: function(hash) {
                             return hash.keys();
                         },
                         getOwnPropertyDescriptor: function(hash, prop) {
                             return { enumerable: true, configurable: true };
                         },
                         get: function(hash, prop) {
                             if(prop == 'target') return hash;
                             return hash.get(prop);
                         },
                         set: function(hash, prop, value) {
                             return hash.set(prop, value);
                         }
                     });
}

DispatchTableProxy.test = function()
{
    var  dt = DispatchTableProxy(0xF0, 4, {
        3: 1234,
        4: 4567
    });

    assert(dt[3<<4] == 1234, 'looks up array accesses');
    dt[10] = 'hello';
    assert(dt[10<<4] == 'hello', 'sets array accesses unshifted');

    var keys = [];
    for(var i in dt) {
        keys.push(i);
    }
    assert(keys[0] == 3<<4);
    assert(keys[1] == 4<<4);
    assert(keys[2] == 10<<4);

    return true;
}

if(typeof(module) != 'undefined') {
  module.exports = DispatchTable;
}
