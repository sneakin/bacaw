// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 4 -*-

require('vm/types.js');

DecodedSample = function(format, context, data, cb)
{
  this.format = format;
  this.buffer = null;
  
  context.decodeAudioData(data,
                          (decoded_data) => {
                            this.buffer = decoded_data;
                            if(cb) cb(false);
                          },
                          (err) => { if(cb) cb(err); else throw(err); });
}

module.exports = DecodedSample;