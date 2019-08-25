const node_util = require('util');

function TD(encoding)
{
}

TD.prototype.decode = function(bytes, options)
{
    return String.fromCharCode.apply(null, bytes);
}

var TextDecoder = TD;
if(node_util != null && node_util['TextDecoder']) { TextDecoder = node_util['TextDecoder'] };
if(global['TextDecoder']) { TextDecoder = global['TextDecoder'] };

if(typeof(module) != 'undefined') {
  module.exports = TextDecoder;
}
