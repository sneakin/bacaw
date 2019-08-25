const Enum = require('enum');

module.exports = new Enum([
  'none',
  'ready',
  'raw_byte',
  'raw_short',
  'raw_long',
  'raw_float',
  'sample',
  [ 'unsigned', 0x80 ]
]);
