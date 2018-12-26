const util = require('util.js');

if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
    VM = {};
}

require('vm/types.js');
require('vm/cpu.js');
require('vm/vm-doc.js');
require('vm/vm-c.js');
require('vm/container.js');
require('vm/devices.js');

VM.Assembler = require('assembler');

VM.run_tests = function()
{
    for(let prop in this) {
        if(this[prop]['test_suite']) {
            console.log("Running tests for " + prop);
            this[prop].test_suite();
        }
    }
}

if(typeof(module) != 'undefined') {
  module.exports = VM;
}
