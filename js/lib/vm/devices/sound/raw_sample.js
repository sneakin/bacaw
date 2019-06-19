// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 4 -*-

require('vm/types.js');
const Format = require('vm/devices/sound/sample_format');

function RawSample(format, context, mem, address, length, rate, num_channels)
{
  this.format = format;
  this.buffer = context.createBuffer(num_channels, length, rate);
  this.copy_sample(mem, address, length);
}

RawSample.prototype.copy_sample = function(mem, addr, length)
{
  var data = this.buffer.getChannelData(0);
  var type = this.format_type();
  
  for(var i = 0; i < length / type.byte_size; i++) {
    data[i] = mem.memread1(addr + i * type.byte_size, type) / type.max;
  }
}

const FormatTypeMap = {};
[ [ Format.raw_long & Format.unsigned, VM.TYPES.ULONG ],
  [ Format.raw_long, VM.TYPES.LONG ],
  [ Format.raw_short & Format.unsigned, VM.TYPES.USHORT ],
  [ Format.raw_short, VM.TYPES.SHORT ],
  [ Format.raw_byte & Format.unsigned, VM.TYPES.UBYTE ],
  [ Format.raw_byte, VM.TYPES.BYTE ],
  [ Format.raw_float, VM.TYPES.FLOAT ]  
].map((d) => FormatTypeMap[d[0]] = d[1]);

RawSample.prototype.format_type = function()
{
  return FormatTypeMap[this.format] || VM.TYPES.ULONG;
}

module.exports = RawSample;
