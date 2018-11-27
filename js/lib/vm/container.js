if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
    VM = {};
}

require('vm/cpu.js');
const Console = require('vm/devices/console');

VM.Container = function(callbacks)
{
    this.devices = [];
    this.cpu = null;
    this.mmu = null;
    this.stopping = false;
    this.window = null;
    this.timer = null;
    this.cycles = 0;
    this.max_cycles = 10000;
    this.callbacks = callbacks || {};
}

VM.Container.prototype.add_device = function(dev)
{
    this.devices.push(dev);
    if(this.cpu == null && dev instanceof VM.CPU) {
        this.cpu = dev;
    }
    if(this.mmu == null && dev instanceof VM.MMU) {
        this.mmu = dev;
    }
    if(this.devcon == null && dev instanceof Console) {
        this.devcon = dev;
    }

    this.do_callback('add_device', dev);
    
    return this;
}

VM.Container.prototype.remove_device = function(dev)
{
    this.devices = remove_value(this.device, dev);
    this.do_callback('remove_device');
    return this;
}

VM.Container.prototype.each_device = function(f)
{
    for(var i = 0; i < this.devices.length; i++) {
        f(this.devices[i], i);
    }
}

VM.Container.prototype.run = function(cycles, freq)
{
    this.running = true;
    this.do_callback('run');

    if(cycles == null) cycles = this.max_cycles;
    var done = this.step_loop(cycles);

    this.schedule(done, cycles);
    
    return this;
}

VM.Container.prototype.schedule = function(all_asleep, cycles)
{
    if(!this.stopping) {
        if(this.timer == null) {
            var self = this;

            if(all_asleep) {
                if(this.debug) console.log("All asleep.");
            } else {
                if(this.debug) console.log("set Timeout.");
                this.timer = setTimeout(function() {
                    self.timer = null;
                    self.run(cycles);
                }, 1);
            }
        } else if(this.debug) {
            console.log("Timer exists");
            this.debug_dump();
        }
    } else {
        this.stopping = false;
        this.running = false;
        this.do_callback('stopped');
    }
}

VM.Container.prototype.step_loop = function(cycles)
{
    /*
    if(this.cpu) {
        this.cpu.run(cycles);
    }
*/
    for(var i = 0; i < cycles; i++) {
        var sleepers = this.step();
        if(sleepers == this.devices.length) return true;
    }

    return false;
}

VM.Container.prototype.stop = function()
{
    this.stopping = true;
    
    this.do_callback('stopping');
    
    this.each_device(function(d) {
        if(d.stop) d.stop();
    });

    return this;
}

VM.Container.prototype.reset = function()
{
    this.each_device(function(d) {
        if(d.reset) d.reset();
    });
    this.do_callback('reset');
    return this;
}

VM.Container.prototype.step = function()
{
    this.cycles++;
    
    this.do_callback('step');
    
    var done = 0;
    this.each_device(function(d) {
        if(d.step == null || !d.step()) {
            done++;
        }
    });

    if(this.debug == 2) this.debug_dump();

    return done;
}

VM.Container.prototype.dbstep = function(cycles)
{
    if(cycles == null) { cycles = 1; }

    for(var i = 0; i < cycles; i++) {
        this.debug_dump();
        
        if(this.step() == true) {
            break;
        }
    }

    this.debug_dump();
    return this;
}

VM.Container.prototype.debug_dump = function()
{
    this.each_device(function(d) {
        if(d.debug_dump) {
            d.debug_dump();
        }
    });
    
    return this;
}


VM.Container.prototype.interrupt = function(n)
{
    this.do_callback('interrupt');

    if(this.cpu) {
        this.cpu.interrupt(n);
    }

    if(this.running) {
        this.schedule();
    }

    return this;
}

VM.Container.prototype.do_callback = function(cb, arg)
{
    if(this.callbacks == null || this.callbacks[cb] == null) return;
    
    this.callbacks[cb](this, arg);
}
