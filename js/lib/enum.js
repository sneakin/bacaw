function Enum(values)
{
    this._keys = [];
    
    if(values instanceof Array) {
        var n = 0;
        for(var i = 0; i < values.length; i++) {
            if(values[i] instanceof Array) {
                n = values[i][1];
                this[n] = values[i][0];
                this[values[i][0]] = n;
            } else {
                this[n] = values[i];
                this[values[i]] = n;
            }
            this._keys.push(this[n]);
            n += 1;
        }
    } else {
        for(var i in values) {
            this[i] = values[i];
            this[values[i]] = i;
            this._keys.push(this[i]);
        }
    }
}

Enum.prototype.keys = function()
{
    return this._keys;
}

Enum.prototype.values = function()
{
    var v = [];
    for(var i of this.keys()) {
        v.push(this[i]);
    }
    return v;
}

Enum.prototype[Symbol.iterator] = function*()
{
    for(var i of this._keys) {
        yield(i);
    }
}

if(typeof(module) != 'undefined') {
  module.exports = Enum;
}
