if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
    VM = {};
}

require('vm/devices/ram.js');
require('vm/devices/memory_bus.js');
require('vm/devices/mmu.js');
require('vm/devices/console.js');
require('vm/devices/gfx.js');
require('vm/devices/keyboard.js');
require('vm/devices/timer.js');
require('vm/devices/keystore.js');
require('vm/devices/sound.js');
