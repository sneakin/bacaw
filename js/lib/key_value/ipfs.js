// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 2 -*-

// TODO ipfs passphrase and keys for enable/reset and private key generation
// TODO storage for ipfs key(s)

const TextDecoder = require('util/text_decoder');
const TextEncoder = require('util/text_encoder');

function KV(ipfs, repo)
{
  this.ipfs = ipfs || global.IPFS;
  this.repository = repo || "ipfs";
}

KV.prototype.enable = function(callback)
{
  if(this.node) {
    callback(false);
    return this;
  }
  
  this.node = new this.ipfs({ repo: this.repository });
  this.node.once('error', () => {
    this.ready = false;
    callback(true);
  });
  this.node.once('ready', () => {
    this.ready = true;
    console.log("IPFS ready");
    callback(false);
  });

  return this;
}

KV.prototype.disable = function(callback)
{
  if(this.node == null) {
    callback(false);
    return this;
  }
  
  this.node.shutdown().then(() => {
    this.node = null;
    this.ready = null;
    callback(false)
  }).catch(() => {
    this.node = null;
    this.ready = null;
    callback(true)
  });

  return this;
}

KV.prototype.unpack_key = function(key)
{
  if(typeof(key) == 'string') return key;
  return (new TextDecoder()).decode(key).replace(/[\x00]+$/, '');
}

KV.prototype.pad_key = function(str)
{
	if(typeof(str) == 'string')
	return (new TextEncoder).encode(str);
	return str;
}


KV.prototype.getValue = function(key, offset, max_length, callback)
{
  this.node.cat(this.unpack_key(key), {
    offset: offset,
    length: max_length
  }, (err, data) => {
    if(err) {
      callback(key, null);
    } else {
      callback(key, data);
    }
  });

  return this;
}

KV.prototype.setItem = function(key, value, callback)
{
  this.node.add(this.ipfs.Buffer.from(value), (err, res) => {
    if(err || !res) {
      callback(key, null);
    } else {
      callback(this.pad_key(res[0].hash), true);
    }
  });
}

KV.prototype.getSize = function(key, callback)
{
  this.getItem(key, (new_key, data) => {
    callback(new_key, data ? data.length : null);
  });
  
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
  window.KeyValue.IPFS = KV;
}

