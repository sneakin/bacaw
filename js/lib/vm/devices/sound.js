// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 4 -*-

require('vm/types.js');
const DataStruct = require('data_struct.js');
const Enum = require('enum.js');
const RAM = require('vm/devices/ram.js');
const more_util = require('more_util');

const Channel = require('vm/devices/sound/channel');
const DecodedSample = require('vm/devices/sound/decoded_sample');
const RawSample = require('vm/devices/sound/raw_sample');

function Sound(num_channels, mem, irq, name)
{
    this.name = name || 'Sound';
    this.mem = mem;
    this.irq = irq;
    this.num_channels = num_channels;
    this.channels = more_util.n_times(num_channels, (n) => new Channel({
        onended: () => {
            if(this.state.status & Sound.Status.irq_enabled) {
                this.irq.trigger();
            }
        }
    }));
    this.struct = Sound.DeviceStruct(num_channels);
    this.ram = new RAM(this.struct.byte_size);
    this.state = this.struct.proxy(this.ram.data_view());
    this.samples = {};
    this.next_sample = 0;
    
    this.disable();
}

Sound.ChannelModes = Channel.Modes;

Sound.BootSound = {
    URI: "sounds/startup.mp3",
    mode: Sound.ChannelModes.sine,
    range: { min: 220, max: 880 },
    duration: 1000 / 64 * 16,
    time_step: 1000 / 64 * 4
};

Sound.ChannelStruct = new DataStruct([
    [ 'mode', VM.TYPES.UBYTE ],
    [ 'param', VM.TYPES.UBYTE ],
    [ 'gain', VM.TYPES.UBYTE ],
    [ 'pan', VM.TYPES.BYTE ],
    [ 'rate', VM.TYPES.ULONG ],
    [ 'start_at', VM.TYPES.ULONG ],
    [ 'stop_at', VM.TYPES.ULONG ],
    [ 'loop_start', VM.TYPES.ULONG ],
    [ 'loop_end', VM.TYPES.ULONG ],
    [ 'data1', VM.TYPES.ULONG ]
]);

Sound.SampleFormat = require('vm/devices/sound/sample_format');

Sound.Sampler = new DataStruct([
    [ 'id', VM.TYPES.ULONG ],
    [ 'address', VM.TYPES.ULONG ],
    [ 'length', VM.TYPES.ULONG ],
    [ 'format', VM.TYPES.ULONG ],
    [ 'num_channels', VM.TYPES.ULONG ],
    [ 'byte_rate', VM.TYPES.ULONG ]
]);

Sound.DeviceStruct = function(num_channels)
{
    return new DataStruct([
        [ 'status', VM.TYPES.UBYTE ],
        [ 'gain', VM.TYPES.UBYTE ],
        [ 'current_time', VM.TYPES.ULONG ],
        [ 'sampler', Sound.Sampler ],
        [ 'num_channels', VM.TYPES.ULONG ],
        [ 'channels', num_channels, Sound.ChannelStruct ]
    ]);
}

Sound.Status = new Enum([
    [ 'none', 0 ],
    [ 'enabled', 1 ],
    [ 'playing', 2 ],
    [ 'demo', 4 ],
    [ 'irq_enabled', 8 ]
    [ 'error', 0x80 ]
]);

Sound.prototype.disable = function()
{
    if(this.context) {
        this.context.close();
        delete this.context;
    }

    this.ram.set(0, this.ram.length, 0);
    this.state.status = Sound.Status.none;
    this.state.num_channels = this.num_channels;
}

Sound.prototype.enable = function()
{
    if(this.context == null) {
        this.context = new AudioContext();
    }
    if(this.gainer == null) {
        this.gainer = this.context.createGain();
        this.gainer.connect(this.context.destination);
        this.gainer.gain.value = 0;
        this.gain = 0;
    }
    
    this.state.status = this.state.status | Sound.Status.enabled;
    this.dirty = true;
}

Sound.prototype.push_sample = function(sample)
{
    var i = ++this.next_sample;
    this.samples[i] = sample;
    return i;
}

Sound.prototype.boot_sound = function(params)
{
    if(params == null) params = Sound.BootSound;

    var osc_chans = this.num_channels - 2;
    
    for(var i = 0; i < osc_chans; i++) {
        this.state.channels[i].mode = params.mode;
        this.state.channels[i].gain = 255;
        this.state.channels[i].pan = -128 + i / osc_chans * 256;
        this.state.channels[i].data1 = params.range.min + i / osc_chans * (params.range.max - params.range.min);
        var start_at = 1 + i * params.time_step;
        this.state.channels[i].start_at = start_at;
        this.state.channels[i].stop_at = start_at + params.duration;
        this.state.channels[i].loop_start = 0;
        this.state.channels[i].loop_end = 0;
    }

    var sample = this.push_sample(new RawSample(Sound.SampleFormat.raw_long,
                                                this.context,
                                                this.mem,
                                                0,
                                                44100 * 2,
                                                11025,
                                                1));
    var last = this.state.channels[this.num_channels - 1];
    last.gain = 255;
    last.pan = 0;
    last.param = 1;
    last.data1 = sample;
    last.loop_start = 0;
    last.loop_end = 1000 * 44100 * 2 / 11025;
    last.start_at = 1 + this.num_channels * params.time_step;
    last.stop_at = 1 + this.num_channels * params.time_step + 10000;
    last.mode = Sound.ChannelModes.sample;

    global.fetch(Sound.BootSound.URI).then((response) => {
        response.arrayBuffer().then((body) => {
            var sample = this.push_sample(new DecodedSample(Sound.SampleFormat.sample,
                                                            this.context,
                                                            body,
                                                            (err) => { if(!err) this.play_sample(this.num_channels - 2, sample, 1 + this.num_channels * params.time_step); }));
        });
    });
}

Sound.prototype.play_sample = function(channel, sample, start_at)
{
    var ch = this.state.channels[channel];
    ch.gain = 255;
    ch.pan = 0;
    ch.param = 1;
    ch.data1 = sample;
    ch.loop_start = 0;
    ch.loop_end = 0;
    ch.start_at = start_at;
    ch.mode = Sound.ChannelModes.sample;
}

Sound.prototype.reset = function()
{
    this.disable();
}

Sound.prototype.ram_size = function()
{
    return this.ram.length;
}

Sound.prototype.read = function(addr, count, output, offset)
{
    return this.ram.read(addr, count, output, offset);
}

Sound.prototype.write = function(addr, data)
{
    this.dirty = true;
    return this.ram.write(addr, data);
}

Sound.prototype.step_channel = function(n)
{
    this.channels[n].step(this.mem, this.context, this.gainer, this.state.channels[n], this.samples);
}

Sound.prototype.create_sample = function()
{
    switch(this.state.sampler.format) {
    case Sound.SampleFormat.raw_byte:
    case Sound.SampleFormat.raw_short:
    case Sound.SampleFormat.raw_long:
    case Sound.SampleFormat.raw_float:
        return new RawSample(this.state.format,
                             this.context,
                             this.mem,
                             this.state.sampler.address,
                             this.state.sampler.length,
                             this.state.sampler.byte_rate,
                             this.state.sampler.num_channels);
        break;
    case Sound.SampleFormat.sample:
        return new DecodedSample(this.state.format,
                                 this.context,
                                 this.mem.memread(this.state.sampler.address, this.state.sampler.length));
        break;
    default:
        return null;
    }
}

Sound.prototype.update_sampler = function()
{
    var sample = this.samples[this.state.sampler.id];

    if(this.state.sampler.format != Sound.SampleFormat.none) {
        this.samples[this.state.sampler.id] = this.create_sample();
        this.state.sampler.format = Sound.SampleFormat.none;
    }
}

Sound.prototype.update_status = function()
{
    var status = this.state.status;
    if(this.last_status == status) return false;
    
    if(status & Sound.Status.enabled) {
        this.enable();
    } else {
        this.disable();
    }

    if(this.context) {
        if(status & Sound.Status.playing) {
            this.context.resume();
        } else {
            this.context.suspend();
        }

        if(status & Sound.Status.demo) {
            this.boot_sound();
            this.state.status = this.state.status & ~Sound.Status.demo;
        }
    }

    this.last_status = this.state.status;
    return true;
}

Sound.prototype.update_gain = function()
{
    if(this.gain != this.state.gain) {
        this.gainer.gain.value = this.state.gain / 255.0;
        this.gain = this.state.gain;
    }
}

Sound.prototype.step = function()
{
    if(this.context) this.state.current_time = Math.floor(this.context.currentTime * 1000);
    if(!this.dirty) return false;
    
    this.update_status();
    if(this.context == null) return false;

    this.update_gain();
    this.update_sampler();
    more_util.n_times(this.num_channels, (n) => this.step_channel(n));

    this.dirty = false;
    
    return false;
}

if(typeof(module) != 'undefined') {
	  module.exports = Sound;
}
if(typeof(VM) != 'undefined') {
    if(VM['Devices'] == null) VM['Devices'] = {};
    VM.Devices.Sound = Sound;
}
