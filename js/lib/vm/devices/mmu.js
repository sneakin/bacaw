// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 4 -*-
"use strict";

if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
    VM = {};
}

// TODO The MMU remaps and provides access control to the memory bus.
// Proction follows the ring model.
// Each ring having a page descriptor table that describes physical to virtual address mappings and access control bits.
// A ring needs to be entered by changing a register to the new page table.
// To exit a ring, an interrupt needs to be triggered and handled.
// Interrupts get handled in the most permissive ring and may be passed to the next ring for handling or not.
// Returning from an interrupt needs to restore the ring.

VM.MMU = function(memory)
{
}

VM.MMU.prototype.step = function()
{
  return false;
}

if(typeof(module) != 'undefined') {
	module.exports = VM.MMU;
}
