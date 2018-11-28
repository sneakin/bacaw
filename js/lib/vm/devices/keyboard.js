require('vm/types.js');
const DataStruct = require('data_struct.js');
const Enum = require('enum.js');
const RingBuffer = require('vm/ring_buffer.js');
const RAM = require('vm/devices/ram.js');

function Keyboard(el, vm, irq)
{
  this.name = "Keyboard";
  this.running = false;
  this.element = el;
  var self = this;
	  this.element.onkeyup = function(ev) { return self.on_key(false, ev); };
	  this.element.onkeydown = function(ev) { return self.on_key(true, ev); };

    this.vm = vm;
    this.irq = irq;
    this.ram = new RAM(Keyboard.MemoryStruct_16.byte_size);
    this.mem = Keyboard.MemoryStruct_16.proxy(this.ram.data_view());
    this.buffer = new RingBuffer(Keyboard.MemoryStruct_16.fields.events.type, this.mem.events)
    this.reset();
}

Keyboard.Modifiers = new Enum([
    [ "NONE", 0 ],
    [ "SHIFT", 1<<0 ],
    [ "CTRL", 1<<1 ],
    [ "ALT", 1<<2 ],
    [ "META", 1<<3 ],
    [ "REPEAT", 1<<4 ],
    [ "PRESSED", 1<<15  ]
]);

Keyboard.EventStruct = new DataStruct([
    [ 'char_code', VM.TYPES.USHORT ],
    [ 'key_code', VM.TYPES.USHORT ],
    [ 'modifiers', VM.TYPES.USHORT ],
    [ 'padding', VM.TYPES.USHORT ]
]);

Keyboard.MemoryStruct = function(n)
{
    return new DataStruct([
        [ 'events', RingBuffer.DataStruct(n, Keyboard.EventStruct) ]
    ]);
}
Keyboard.MemoryStruct_16 = Keyboard.MemoryStruct(16);

Keyboard.prototype.reset = function()
{
    this.buffer.clear();
}

Keyboard.prototype.step = function()
{
  this.running = true;
  return false;
}

Keyboard.prototype.stop = function()
{
  this.running = false;
}

Keyboard.prototype.encode_modifiers = function(pressed, ev)
{
    var r = 0;
    if(pressed) r = r | Keyboard.Modifiers.PRESSED;
    if(ev.altKey) r = r | Keyboard.Modifiers.ALT;
    if(ev.ctrlKey) r = r | Keyboard.Modifiers.CTRL;
    if(ev.metaKey) r = r | Keyboard.Modifiers.META;
    if(ev.shiftKey) r = r | Keyboard.Modifiers.SHIFT;
    if(ev.repeat) r = r | Keyboard.Modifiers.REPEAT;
    return r;
}

Keyboard.prototype.buffer_size = function()
{
    return this.buffer.length();
}

Keyboard.prototype.buffer_full = function()
{
    return this.buffer.full();
}

Keyboard.prototype.on_key = function(pressed, ev)
{
    if(ev.target.tagName == 'INPUT') {
        if(this.debug) console.log(ev);
        return;
    }
    
  if(this.running != true) return;
  
    if(ev.key == 'r' && ev.ctrlKey) {
        return;
    }
    
    ev.preventDefault();
    if(ev.repeat) return;

    var kb_ev = {
        char_code: ev.charCode,
        modifiers: this.encode_modifiers(pressed, ev),
        key_code: ev.keyCode
    };

    if(this.debug) {
	    console.log("on_key " + pressed, ev, ev.code, this.mem.events.read_offset, this.mem.events.write_offset, this.buffer.empty(), this.buffer.length(), kb_ev);
    }

  this.buffer.push(kb_ev);
  // todo beep if the buffer is full?
  this.vm.interrupt(this.irq);
}

Keyboard.prototype.read = function(addr, count, output, offset)
{
    return this.ram.read(addr, count, output, offset);
}

Keyboard.prototype.read1 = function(addr, type)
{
    return this.ram.read1(addr, type);
}

Keyboard.prototype.write = function(addr, data)
{
    return this.ram.write(addr, data);
}

Keyboard.prototype.write1 = function(addr, value, type)
{
    return this.ram.write1(addr, value, type);
}

Keyboard.prototype.ram_size = function()
{
    return this.ram.length;
}

if(typeof(module) != 'undefined') {
	module.exports = Keyboard;
}

