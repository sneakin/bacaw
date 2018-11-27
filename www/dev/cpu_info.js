function CPUInfo()
{
    this.last_cycle = 0;
    this.frames = 0;
}

CPUInfo.prototype.update = function(vm, dt)
{
    var cycles = vm.cycles;
    var dc = cycles - this.last_cycle;
    this.last_cycle = cycles;
    this.frames += 1;
    
    document.getElementById('info-cycles').innerText = vm.cycles.toString();
    var dcdt = (dc / (dt / 1000.0));
    if(dcdt > 0.0001) document.getElementById('info-cycles-per-sec').innerText = dcdt.toFixed(4);
    var dfdt = (1.0 / (dt / 1000.0));
    if(dfdt > 0.0001) document.getElementById('info-frames-per-sec').innerText = dfdt.toFixed(4);
    if(dt > 0.0001) document.getElementById('info-time-per-frame').innerText = dt.toFixed(4);
}

if(typeof(module) != 'undefined') {
    module.exports = CPUInfo;
}
