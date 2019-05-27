function KV(data)
{
  this.data = data || new Object();
}

KV.prototype.enable = function(callback)
{
  callback(false);
  return this;
}

KV.prototype.disable = function(callback)
{
  callback(false);
  return this;
}

KV.prototype.pack_key = function(key)
{
  if(typeof(key) == 'string') return key;
  return (new TextDecoder()).decode(key).replace(/[\x00]+$/, '');
}

KV.prototype.unpack_key = function(str)
{
	if(typeof(str) == 'string')
	return (new TextEncoder).encode(str);
	return str;
}

KV.prototype.getValue = function(key, offset, length, callback)
{
  var value = this.data[this.pack_key(key)];
  if(value) value = value.slice(offset, offset+length);
  callback(key, value);
  return this;
}

KV.prototype.setItem = function(key, value, callback)
{
  this.data[this.pack_key(key)] = value;
  callback(key, true);
  return this;
}

KV.prototype.getSize = function(key, callback)
{
  var length = null;
  var value = this.data[this.pack_key(key)];
  if(value) length = value.length;
  callback(key, length);
  return this;
}

KV.prototype.removeItem = function(key, callback)
{
  delete this.data[this.pack_key(key)];
  callback(key, true);
  return this;
}

if(typeof(module) != 'undefined') {
  module.exports = KV;
}
if(typeof(window) != 'undefined') {
  if(!window['KeyValue']) {
    window['KeyValue'] = {};
  }
  window.KeyValue.Table = KV;
}

