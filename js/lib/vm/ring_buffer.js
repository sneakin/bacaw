if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
    VM = {};
}

const DataStruct = require('data_struct.js');

// Ring buffers https://www.snellman.net/blog/archive/2016-12-13-ring-buffers/
VM.RingBuffer = function(data_struct, buffer)
{
    if(typeof(data_struct) == 'number') {
        this.ds = VM.RingBuffer.DataStruct(data_struct, buffer);
        this.buffer = this.ds.allocate();
    } else {
        this.ds = data_struct;
        this.buffer = buffer || this.ds.allocate();
    }
}

VM.RingBuffer.DataStruct = function(size, element_type)
{
    return new DataStruct([
        [ 'read_offset', VM.TYPES.ULONG ],
        [ 'write_offset', VM.TYPES.ULONG ],
        [ 'buffer', size, element_type || VM.TYPES.ULONG ]
    ]);
}

VM.RingBuffer.prototype.length = function()
{
    var n = this.buffer.write_offset - this.buffer.read_offset;
    if(n < 0) {
        n = this.capacity() + n;
    }
    return n;
}

VM.RingBuffer.prototype.freed = function()
{
  return this.capacity() - this.length();
}

VM.RingBuffer.prototype.full = function()
{
    return this.length() == (this.buffer.buffer.length - 1);
}

VM.RingBuffer.prototype.empty = function()
{
    return this.buffer.read_offset == this.buffer.write_offset;
}

VM.RingBuffer.prototype.clear = function()
{
    this.buffer.read_offset = this.buffer.write_offset = 0;
    return this;
}

VM.RingBuffer.prototype.push = function(item)
{
    if(!this.full()) {
        if(typeof(item) == 'object') {
            this.buffer.buffer[this.buffer.write_offset].update_from(item);
        } else {
            this.buffer.buffer[this.buffer.write_offset] = item;
        }
        this.buffer.write_offset = (this.buffer.write_offset + 1) % this.buffer.buffer.length;
        return this;
    } else {
        return null;
    }
}

VM.RingBuffer.prototype.shift = function()
{
    if(!this.empty()) {
        var item = this.buffer.buffer[this.buffer.read_offset];
        this.buffer.read_offset = (this.buffer.read_offset + 1) % this.buffer.buffer.length;
        return item;
    } else {
        return null;
    }
}

VM.RingBuffer.prototype.pop = function()
{
}

VM.RingBuffer.prototype.unshift = function()
{
}

VM.RingBuffer.prototype.capacity = function()
{
    return this.buffer.buffer.length;
}

VM.RingBuffer.test_suite = function()
{
  var assert = require("asserts");
    var n = 32;
    var ds = VM.RingBuffer.DataStruct(n);
    var a = new VM.RingBuffer(ds);
    assert.equal(a.length(), 0, 'no items');
    assert.equal(a.capacity(), n, 'correct limit');
    assert.equal(a.freed(), n, 'no items, so full limit');
    assert.equal(a.full(), false, 'is empty');
    assert.equal(a.empty(), true, 'is empty');

    a.push(123);
    assert.equal(a.length(), 1, 'has an item');
    assert.equal(a.freed(), a.capacity() - 1, 'less a free slot');
    assert.equal(a.shift(), 123, 'shifts off the pushed item');
    assert.equal(a.length(), 0, 'back to empty');
    assert.equal(a.empty(), true, 'back to empty');
    assert.equal(a.freed(), n, 'no items, so full limit');

    for(var i = 0; i < (n - 1); i++) {
        assert.assert(a.push(i), 'returns null on fail ' + i);
        assert.equal(a.length(), i + 1, 'one for one increases');
    }
    assert.equal(a.full(), true, 'is full');
    assert.equal(a.push(123), null, 'adds no more');

    for(var i = 0; i < (n - 1); i++) {
        assert.equal(a.shift(), i, 'shifts off the order the were pushed');
        assert.equal(a.length(), (n - 1) - (i + 1), 'size decreases');
    }
    assert.equal(a.empty(), true, 'is empty');
    assert.equal(a.full(), false, 'not full');
    assert.equal(a.shift(), null, 'shifts null when empty');

    a.push(123).push(456);
    assert.equal(a.length(), 2, 'length matches');
    a.clear();
    assert.equal(a.empty(), true, 'now empty');
    assert.equal(a.length(), 0, 'length is 0');

    var ds = new DataStruct([
        [ 'a', VM.TYPES.ULONG ],
        [ 'b', VM.TYPES.BYTE ]
    ]);
    var b_data = VM.RingBuffer.DataStruct(4, ds);
    var b = new VM.RingBuffer(b_data)
    var x = ds.allocate().update_from({a: 123, b: 45});
    
    assert.assert(b.push(x), 'pushes structs');
    assert.equal(b.shift(), x, 'shifts structs');
    
    return a;
}

if(typeof(module) != 'undefined') {
  module.exports = VM.RingBuffer;
}
