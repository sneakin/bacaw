// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 2 -*-

// TODO ipfs passphrase and keys for enable/reset and private key generation
// TODO storage for ipfs key(s)

const TextDecoder = require('util/text_decoder');
const TextEncoder = require('util/text_encoder');
const more_util = require('more_util');

function KV(ipfs, repo, password)
{
  this.ipfs = ipfs || global.IPFS;
  this.options = {
    repo: repo || "ipfs",
    pass: password
  };
}

KV.prototype.enable = function(callback)
{
  if(this.node) {
    callback(false);
    return this;
  }
  
  this.node = new this.ipfs(this.options);
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

KV.prototype.split_key = function(key)
{
  return key.split(':');
}

KV.prototype.getValue = function(key, offset, max_length, callback)
{
  var key_str = this.unpack_key(key);
  var parts = this.split_key(key_str);
  if(parts[0] == "config") {
    callback(key, this.options[parts[1]]);
  } else if(parts[0] == "key") {
    if(parts[1] == "list") {
      this.node.key.list().then((keys) => {
        if(keys.length > 0) {
          callback(key, this.pad_key(keys.map((k) => `${k.name}\t${k.id}`).join("\n")));
        } else {
          callback(key, null);
        }
      });
    } else {
      this.node.key.export(parts[1], parts[2], (err, ipfs_key) => {
        callback(key, err ? null : this.pad_key(ipfs_key));
      });
    }
  } else if(parts[0] == "publish") {
    this.node.name.resolve(parts[1], (err, result) => {
      callback(key, err ? null : this.pad_key(result.path));
    });
  } else {
    this.node.cat(key_str, {
      offset: offset,
      length: max_length
    }, (err, data) => {
      if(err) {
        callback(key, null);
      } else {
        callback(key, data);
      }
    });
  }
  
  return this;
}

KV.prototype.setItem = function(key, value, callback)
{
  var key_str = this.unpack_key(key);
  var parts = this.split_key(key_str);
  if(parts[0] == "config") {
    this.options[parts[1]] = this.unpack_key(value);
    callback(key, true);
  } else if(parts[0] == "key") {
    this.node.key.import(parts[1], value, parts[2], (err, ipfs_key) => {
      callback(key, true);
    });
  } else if(parts[0] == "publish") {
    this.node.name.publish(this.unpack_key(value), {
      key: parts[1]
    }, (err, ipfs_key) => {
      callback(key, !(err == null));
    });
  } else {
    this.node.add(this.ipfs.Buffer.from(value), (err, res) => {
      if(err || !res) {
        callback(key, null);
      } else {
        callback(this.pad_key(res[0].hash), true);
      }
    });
  }
}

KV.prototype.getSize = function(key, callback)
{
  this.getValue(key, (new_key, data) => {
    callback(new_key, data ? data.length : null);
  });
  
  return this;
}

KV.prototype.removeItem = function(key, callback)
{
  var key_str = this.unpack_key(key);
  var parts = this.split_key(key_str);
  if(parts[0] == "config") {
    delete this.options[parts[1]];
    callback(key, null);
  } else if(parts[0] == "key") {
    this.node.key.rm(parts[1], (err, key) => {
      callback(key, !(err == null));
    });
  } else {
    callback(key, null);
  }
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

