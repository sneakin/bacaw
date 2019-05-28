"use strict";

if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
    VM = {};
}

VM.MMU = function()
{
}

VM.MMU.prototype.step = function()
{
  return false;
}

if(typeof(module) != 'undefined') {
	module.exports = VM.MMU;
}
