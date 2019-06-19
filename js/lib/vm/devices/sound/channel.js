// -*- mode: JavaScript; coding: utf-8-unix; javascript-indent-level: 4 -*-

require('vm/types.js');
const Enum = require('enum.js');

function Channel(options)
{
    this.mode = null;
    this.onended = options['onended'];
}

Channel.Modes = new Enum([
    'off',
    'sine',
    'square',
    'triangle',
    'sawtooth',
    'noise',
    'raw',
    'sample'
]);

const ModeKind = {};
[ [ Channel.Modes.sine, 'sine' ],
  [ Channel.Modes.square, 'square' ],
  [ Channel.Modes.triangle, 'triangle' ],
  [ Channel.Modes.sawtooth, 'sawtooth' ]
].map((m) => ModeKind[m[0]] = m[1]);

Channel.prototype.create_oscillator = function(context, mode)
{
    var kind = ModeKind[mode];
    if(kind) {
        var osc = context.createOscillator();
        osc.type = kind;
        return osc;
    } else {
        throw { name: "UnknownMode", value: mode };
    }
}

Channel.prototype.create_sampler = function(context)
{
    var node = context.createBufferSource();
    return node;
}

Channel.prototype.wire_node = function(context, destination)
{
    if(this.gainer == null) {
        this.gainer = context.createGain();
        this.gainer.connect(destination);
    }
    
    if(this.panner == null) {
        this.panner = context.createStereoPanner();
        this.panner.connect(this.gainer);
    }
    
    this.node.onended = (ev) => { this.ended(); }
    this.node.connect(this.panner);
}

Channel.prototype.ended = function()
{
    this.stop();
    if(this.onended) this.onended();
}

Channel.prototype.stop = function(when)
{
    if(this.node) {
        try {
            this.node.stop(when);
        } catch(e) {
            if(e.name != 'InvalidStateError') throw(e);
        }
        delete this.node;
    }

    if(this.gainer) {
        delete this.gainer;
    }
    
    if(this.panner) {
        delete this.panner;
    }

    this.started_at = null;
    this.stop_at = null;
    this.mode = null;
    this.rate = null;
    this.pan = null;
    this.gain = null;
}

Channel.prototype.set_mode = function(mode)
{
    this.stop();
    this.mode = mode;
}

Channel.prototype.update_state = function(mem, context, destination, state, samples)
{
    var start_at = context.currentTime + state.start_at / 1000.0;
    
    switch(this.mode) {
    case Channel.Modes.sine:
    case Channel.Modes.square:
    case Channel.Modes.triangle:
    case Channel.Modes.sawtooth:
        if(this.node == null) {
            this.node = this.create_oscillator(context, state.mode);
            this.wire_node(context, destination);
        }

        if(this.rate != state.data1) {
            this.rate = state.data1;
            this.node.frequency.setValueAtTime(state.data1, start_at);
        }

        break;
    case Channel.Modes.sample:
        if(this.node == null) {
            if(state.data1 > 0) {
                var sample = samples[state.data1];
                if(sample) {
                    this.node = this.create_sampler(context);
                    this.node.buffer = sample.buffer;
                    this.wire_node(context, destination);
                    
                    state.data1 = 0;
                }
            }
        }

        if(this.node != null) {
            if(state.loop_end != 0) {
                this.node.loop = true;
                this.node.loopStart = state.loop_start / 1000;
                this.node.loopEnd = state.loop_end / 1000;
            } else {
                this.node.loop = false;
                this.node.loopStart = 0;
                this.node.loopEnd = 0;
            }
        }
        
        break;
    default:
    }

    if(this.gainer && this.gain != state.gain) {
        this.gainer.gain.setValueAtTime(state.gain / 255, start_at);
    }
    
    if(this.panner && this.pan != state.pan) {
        this.panner.pan.setValueAtTime(state.pan / 128, start_at);
    }
    
    if(this.node) {
        if(state.start_at > 0 && this.started_at == null) {
            this.node.start(start_at);
            this.started_at = state.start_at;
            state.start_at = 0;
        }
        if(state.stop_at > 0) {
            this.stop(context.currentTime + state.stop_at / 1000.0);
            state.stop_at = 0;
        }
    }
}

Channel.prototype.update_mode = function(mode)
{
    if(this.mode != mode) {
        this.set_mode(mode);
    }
}

Channel.prototype.step = function(mem, context, destination, state, samples)
{
    this.update_mode(state.mode);
    this.update_state(mem, context, destination, state, samples);
}

module.exports = Channel;