const node_util = require('util');

function TE(encoding)
{
}

TE.prototype.encode = function(str, options)
{
  var buffer = new Uint8Array(str.length);
  for(var i = 0; i < str.length; i++) {
    buffer[i] = str.charCodeAt(i);
  }
  return buffer;
}

var TextEncoder = TE;
if(node_util != null && node_util['TextEncoder']) { TextEncoder = node_util['TextEncoder']; }
if(global['TextEncoder']) { TextEncoder = global['TextEncoder']; }

if(typeof(module) != 'undefined') {
  module.exports = TextEncoder;
}
