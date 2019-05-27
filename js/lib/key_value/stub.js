function KV()
{
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
  callback(key, false);
  return this;
}

KV.prototype.setItem = function(key, value, callback)
{
  callback(key, false);
  return this;
}

KV.prototype.getSize = function(key, callback)
{
  callback(key, false);
  return this;
}

KV.prototype.removeItem = function(key, callback)
{
  callback(key, null);
  return this;
}

if(typeof(module) != 'undefined') {
  module.exports = KV;
}
if(typeof(window) != 'undefined') {
  if(!window['KeyValue']) {
    window['KeyValue'] = {};
  }
  window.KeyValue.Stub = KV;
}

