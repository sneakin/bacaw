if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
    VM = {};
}

require('vm/cpu.js');

VM.Container = function()
{
    this.devices = [];
    this.cpu = null;
    this.stopping = false;
    this.window = null;
    this.timer = null;
    this.cycles = 0;
}

VM.Container.prototype.add_device = function(dev)
{
    this.devices.push(dev);
    if(this.cpu == null && dev instanceof VM.CPU) {
        this.cpu = dev;
    }
    return this;
}

VM.Container.prototype.remove_device = function(dev)
{
    this.devices = remove_value(this.device, dev);
    return this;
}

VM.Container.prototype.each_device = function(f)
{
    for(var i = 0; i < this.devices.length; i++) {
        f(this.devices[i]);
    }
}

VM.Container.prototype.run = function(cycles, freq)
{
    var self = this;
    this.each_device(function(d) {
        if(d.get_ready) d.get_ready();
    });

    //if(cycles == null) cycles = 10000;
    this.step_loop(cycles);    

    return this;
}

VM.Container.prototype.step_loop = function(cycles)
{
    if(this.cpu) {
        this.cpu.run(cycles);
    }
    // for(var i = 0; i < cycles; i++) {
    //   this.each_device(function(d) {
    //         if(d.step) d.step();
    //     });
    // }
}

VM.Container.prototype.stop = function()
{
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
    return this;
}

VM.Container.prototype.step = function()
{
    this.cycles++;
    
    var done = false;
    this.each_device(function(d) {
        if(d.step && d.step() == false) {
            done = true;
        }
    });

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
