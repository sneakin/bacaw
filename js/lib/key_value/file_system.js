// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 2 -*-

const fs = require('fs');
const TextDecoder = require('util/text_decoder');
const TextEncoder = require('util/text_encoder');

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
  fs.readFile(this.unpack_key(key), (err, data) => {
    if(err) {
      callback(key, null);
    } else {
      callback(err, (new Uint8Array(data)).slice(offset, offset + length));
    }
  });
  
  return this;
}

KV.prototype.setItem = function(key, value, callback)
{
  fs.writeFile(this.unpack_key(key), value, (err) => {
    callback(key, err);
  });
  return this;
}

KV.prototype.getSize = function(key, callback)
{
  fs.stat(this.unpack_key(key), (err, stats) => {
    callback(key, stats ? stats.size : 0);
  });
  return this;
}

KV.prototype.removeItem = function(key, callback)
{
  fs.unlink(this.unpack_key(key), (err) => {
    callback(key, err);
  });
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

