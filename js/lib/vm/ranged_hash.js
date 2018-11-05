function RangedHashImp()
{
    this._items = [];
}

var ranged_hash_proxy = {
    get: function(hash, prop) {
        if(hash[prop]) {
            return hash[prop];
        } else {
            return hash.get(prop);
        }
    }
};

function RangedHash()
{
    var hash = new RangedHashImp();
    return new Proxy(hash, ranged_hash_proxy);
}

RangedHash.AddressUsedError = function(starting, ending) {
  this.msg = "Address ranged is already mapped";
  this.starting = starting;
  this.ending = ending;
}
RangedHash.AddressUsedError.prototype.toString = function() {
  var addr = 'null';
  if(this.starting != null) {
    addr = this.starting.toString(10) + " 0x" + this.starting.toString(16);
    if(this.ending != null) {
      addr += " to ";
      addr += this.ending.toString(10) + " 0x" + this.ending.toString(16);
    }
  }
  return this.msg + ": " + addr;
}

RangedHash.InvalidAddressError = function(addr) {
  this.msg = "Invalid address";
  this.addr = addr;
}
RangedHash.InvalidAddressError.prototype.toString = function() {
  var addr = 'null';
  if(this.addr != null) {
    addr = this.addr.toString(10) + " 0x" + this.addr.toString(16);
  }
  return this.msg + ": " + addr;
}
RangedHash.InvalidRangeError = "Invalid range";


function RangeElement(start, ending, value)
{
    if(ending <= start) {
        throw RangedHash.InvalidRangeError;
    }
    
    this.start = start;
    this.ending = ending;
    this.value = value;
    this.length = this.ending - this.start;
}

RangedHashImp.prototype.add = function(start, ending, value)
{
    try {
      var it = this.get(start);
      if(it) {
        throw new RangedHash.AddressUsedError(start, ending);
      }
    } catch(err) {
      if(err instanceof RangedHash.InvalidAddressError) {
        this._items.push(new RangeElement(start, ending, value));
      } else {
        throw(err);
      }
    }
}

RangedHashImp.prototype.remove = function(addr)
{
    var it = this.getn(addr);
    delete this._items[it];
}

RangedHashImp.prototype.getn = function(addr)
{
    for(var i in this._items) {
        var it = this._items[i];
        if(addr >= it.start && addr < it.ending) {
            return i;
        }
    }

  throw new RangedHash.InvalidAddressError(addr);
}

RangedHashImp.prototype.gete = function(addr)
{
    return this._items[this.getn(addr)];
}

RangedHashImp.prototype.get = function(addr)
{
    return this.gete(addr).value;
}

RangedHashImp.prototype.each = function(cb)
{
    for(var i in this._items) {
        cb(this._items[i], i);
    }
    return this;
}

RangedHashImp.prototype.collect = function(cb)
{
    var r = [];
    for(var i in this._items) {
        r.push(cb(this._items[i], i));
    }
    return r;
}

if(typeof(module) != 'undefined') {
  module.exports = RangedHash;
}
if(typeof(window) != 'undefined') {
  window.RangedHash = RangedHash;
}
