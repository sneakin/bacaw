// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 2 -*-

const TextEncoder = require('util/text_encoder');
const TextDecoder = require('util/text_decoder');
const more_util = require('more_util');

function KV(storage)
{
  this.storage = storage;
}

KV.prototype.enable = function(callback)
{
  callback(this.storage == null);
  return this;
}

KV.prototype.disable = function(callback)
{
  callback(false);
  return this;
}

KV.prototype.getItem = function(key, attr, callback)
{
  var value = this.storage.getItem(this.from_bytes(key) + '/' + attr);
  callback(key, value);
  return this;
}

KV.prototype.getValue = function(key, offset, max_length, callback)
{
  return this.getItem(key, 'value', (new_key, item) => {
    var data = item ? this.to_bytes(item) : null;
    if(data && (offset || max_length)) {
      var length = Math.min(data.length, max_length);
      data = data.slice(offset, offset + length);
    }
    callback(new_key, data);
  });
}

KV.prototype.getSize = function(key, callback)
{
  return this.getItem(key, 'size', (new_key, item) => {
    callback(new_key, item ? parseInt(size) : null);
  });
}

KV.prototype.setItem = function(key, value, callback)
{
  var key_string = this.from_bytes(key);
  this.storage.setItem(key_string + '/value', this.from_bytes(value));
  this.storage.setItem(key_string + "/size", value.length);
  callback(key, true);
  return this;
}

KV.prototype.removeItem = function(key, callback)
{
  var key_string = this.from_bytes(key);
  this.storage.removeItem(key_string + '/value');
  this.storage.removeItem(key_string + '/size');
  callback(key, true);
  return this;
}

KV.prototype.to_bytes = function(buffer)
{
  return new Uint8Array(more_util.from_hexdump(buffer));
}

KV.prototype.from_bytes = function(str)
{
  return more_util.to_hexdump(str);
}

if(typeof(module) != 'undefined') {
  module.exports = KV;
}
if(typeof(window) != 'undefined') {
  window.KeyValueDB = KV;
}

