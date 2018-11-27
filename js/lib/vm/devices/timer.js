const Enum = require('enum.js');
const DataStruct = require('data_struct.js');
const VMJS = require('vm.js');
const RAM = require('vm/devices/ram.js');

function Timer(vm, irq, frequency)
{
  this.name = "Timer";
    this.vm = vm;
    this.irq = irq;
    this.frequency = frequency;
    if(this.frequency == null) this.frequency = 1<<20;
    this.ram = new RAM(Timer.MemoryStruct.byte_size);
    this.data = Timer.MemoryStruct.proxy(this.ram.data_view());
    this.timers = new Array(4);
    this.reset();
}

Timer.Flags = new Enum([
    'NONE',
    'ZERO'
]);

Timer.TimerStruct = new DataStruct([
    [ 'flags', VM.TYPES.ULONG ],
    [ 'counter', VM.TYPES.ULONG ],
    [ 'divider', VM.TYPES.ULONG ],
    [ 'maximum', VM.TYPES.ULONG ],
]);

Timer.MemoryStruct = new DataStruct([
    [ 'last_timer', VM.TYPES.ULONG ],
    [ 'timers', 4, Timer.TimerStruct ]
]);

Timer.prototype.stop = function()
{
    for(var i = 0; i < this.timers.length; i++) {
        this.cancel_timer(i);
    }
}

Timer.prototype.reset = function()
{
    this.stop();
    for(var i = 0; i < this.timers.length; i++) {
        this.data.timers[i].flags = 0;
        this.data.timers[i].counter = 0;
        this.data.timers[i].divider = VM.TYPES.ULONG.max;
        this.data.timers[i].maximum = VM.TYPES.ULONG.max;
    }
}

Timer.prototype.read = function(addr, count, output, offset)
{
    return this.ram.read(addr, count, output, offset);
}

Timer.prototype.write = function(addr, data)
{
    var n = this.ram.write(addr, data);
    this.step();
    return n;
}

Timer.prototype.tick_timers = function()
{
    for(var i = 0; i < this.timers.length; i++) {
        this.update_timer(i);
    }
}

Timer.prototype.step = function()
{
  return false;
}

Timer.prototype.update_timer = function(timer)
{
    if(timer >= 0 && timer < this.timers.length) {
        if(this.data.timers[timer].divider == VM.TYPES.ULONG.max || this.data.timers[timer].maximum == 0) {
            this.cancel_timer(timer);
        } else {
            if(this.timers[timer] && this.timers[timer][1] != this.timer_interval(timer)) {
                this.cancel_timer(timer);
            }
            
            if(this.timers[timer] == null) {
                this.start_timer(timer);
            }
        }
    }
}

Timer.prototype.cancel_timer = function(timer)
{
    if(this.timers[timer]) {
        window.clearInterval(this.timers[timer][0]);
        this.timers[timer] = null;
    }
}

Timer.timer_interval = function(freq, divider, max)
{
    return ((freq >> divider) * max); // & (VM.TYPES.ULONG.max - 1);
}

Timer.timer_max = function(freq, divider, sec)
{
    return sec / (freq >> divider);
}

Timer.prototype.timer_interval = function(timer)
{
    if(timer >= 0 && timer < this.timers.length) {
        return Timer.timer_interval(this.frequency, this.data.timers[timer].divider, this.data.timers[timer].maximum);
    } else {
        return 0;
    }
}

Timer.prototype.start_timer = function(timer)
{
    if(timer >= 0 && timer < this.timers.length) {
        if(this.timers[timer] == null) {
            var t = this.timer_interval(timer);
            var self = this;
            this.timers[timer] = [ window.setInterval(function() {
                self.tick(timer)
                self.step();
            }, t * 1000), t ];
        }
    } else {
        return false;
    }
}

Timer.prototype.tick = function(timer)
{
    if(timer >= 0 && timer < this.timers.length) {
        //console.log("Ticking " + timer);
        this.data.timers[timer].counter += 1;
        this.data.last_timer = timer;
        this.vm.interrupt(this.irq);
    }
}

Timer.prototype.ram_size = function()
{
    return this.ram.length;
}

if(typeof(module) != 'undefined') {
  module.exports = Timer;
}
