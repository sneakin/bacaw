const TextDecoder = require('util/text_decoder');
const TextEncoder = require('util/text_encoder');

function KV(fetch)
{
  this._fetch = fetch || global.fetch;
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

KV.prototype.unpack_key = function(key)
{
  if(typeof(key) == 'string') return key;
  return (new TextDecoder()).decode(key).replace(/[\x00]+$/, '');
}

KV.prototype.pack_key = function(str)
{
	if(typeof(str) == 'string')
	return (new TextEncoder).encode(str);
	return str;
}

KV.prototype.fetch = function(key, opts)
{
  return this._fetch(this.unpack_key(key), opts);
}

KV.prototype.send_request = function(key, req_opts, callback)
{
  return this.fetch(key, req_opts).then((response) => {
    if(response.ok) {
      response.arrayBuffer().then((body) => {
        callback(this.pack_key(response.url), new Uint8Array(body));
      });
    } else {
      callback(key, null);
    }
  }).catch((error) => {
    callback(key, null);
  });
}

KV.prototype.getValue = function(key, offset, length, callback)
{
  var headers = {};
  if(offset) {
    if(!length) length = '';
    headers['Range'] = 'bytes=' + offset + '-' + length;
  }

  this.send_request(key, {
    method: "GET",
    headers: headers
  }, callback);

  return this;
}

KV.prototype.setItem = function(key, value, callback)
{
  this.send_request(key, {
    method: "POST"
  }, callback);

  return this;
}

KV.prototype.getSize = function(key, callback)
{
  this.fetch(key, {
    method: "HEAD"
  }).then((response) => {
    callback(this.pack_key(response.url), response.headers['Content-Length']);
  }).catch((error) => {
    callback(key, null);
  });

  return this;
}

KV.prototype.removeItem = function(key, callback)
{
  this.fetch(key, {
    method: 'DELETE'
  }).then((response) => {
    callback(key, response.ok);
  }).catch((error) => {
    callback(key, null);
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
  window.KeyValue.HTTP = KV;
}
