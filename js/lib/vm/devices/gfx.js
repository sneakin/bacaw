"use strict";

const Enum = require('enum.js');
const DataStruct = require('data_struct.js');
const RangedHash = require('vm/ranged_hash.js');
const RAM = require('vm/devices/ram.js');
const util = require('util.js');

const PixelBuffer = require("vm/devices/gfx/pixel_buffer");
const Layer = require("vm/devices/gfx/layer");
const Command = require("vm/devices/gfx/command");

function GFX(irq, canvases_for_layers, w, h, mem_size, pixel_width, pixel_height, img_srcs)
{
    this.name = "GFX";
    this.mem_size = mem_size;
    this.input_ram = new RAM(mem_size);
    this.input_struct = GFX.InputMemory(canvases_for_layers.length, mem_size);
    this.input_data = this.input_struct.proxy(this.input_ram.data_view());
    var self = this;
    this.layers = util.map_each_n(canvases_for_layers, function(l, n) {
        return new GFX.Layer(n, l, self.input_data.layers[n].view, w, h);
    });
    this.images = img_srcs;
    this.input_data.current_layer = 0;
    this.input_data.flags = GFX.Flags.SYNC;
    this.irq = irq;
    this.next_output_addr = 0;
    this.timer = null; //[];
    this.pixel_buffer = new GFX.PixelBuffer(pixel_width || w,
                                            pixel_height || h);
    this.pixel_offset = this.input_struct.byte_size;
}

const SIZEOF_FLOAT = Float32Array.BYTES_PER_ELEMENT;
const SIZEOF_SHORT = Uint16Array.BYTES_PER_ELEMENT;
const SIZEOF_LONG = Uint32Array.BYTES_PER_ELEMENT;

GFX.PixelBuffer = PixelBuffer;
GFX.Layer = Layer;
GFX.Command = Command;

GFX.MAX_LAYERS = 16;

GFX.UnknownCommandError = "Unknown command error";

GFX.Flags = new Enum({
    NONE: 0,
    SYNC: 1,
    RESYNC: 2
});

GFX.LayerMemory = new DataStruct([
    [ 'id', VM.TYPES.BYTE ],
    [ 'visible', VM.TYPES.UBYTE ],
    [ 'width', VM.TYPES.ULONG ],
    [ 'height', VM.TYPES.ULONG ],
    [ 'x', VM.TYPES.FLOAT, 0.0 ],
    [ 'y', VM.TYPES.FLOAT, 0.0 ],
    [ 'z', VM.TYPES.LONG, 0 ],
    [ 'alpha', VM.TYPES.FLOAT, 0.0 ]
], true, SIZEOF_LONG);

GFX.InputMemory = function(num_layers, mem_size, stack_size)
{
    stack_size = stack_size || 16;
    
    return new DataStruct([
        [ 'flags', VM.TYPES.ULONG ],
        [ 'last_error', VM.TYPES.ULONG ],
        [ 'error_offset', VM.TYPES.ULONG ],
        [ 'result', VM.TYPES.ULONG ],
        [ 'result_values', 8, VM.TYPES.FLOAT ],
        [ 'current_layer', VM.TYPES.ULONG ],
        [ 'layers', num_layers, GFX.LayerMemory ],
        [ 'swapping', VM.TYPES.ULONG ],
        [ 'ip', VM.TYPES.ULONG ],
        [ 'sp', VM.TYPES.ULONG ],
        [ 'call_stack', stack_size, VM.TYPES.ULONG ],
        [ 'input', (mem_size - num_layers * GFX.LayerMemory.byte_size - (17 + stack_size) * VM.TYPES.ULONG.byte_size), VM.TYPES.UBYTE ],
        [ 'swap', VM.TYPES.ULONG ]
    ], true, SIZEOF_LONG);
}

const GFX_COMMANDS = [
    [ "NOP", "" ],
    [ "COMPOSITE", "" ],
    [ "RESET", "" ],
    [ "CLEAR", "" ],
    [ "SET_FILL", "BBBB" ],
    [ "SET_LINE", "BBBB" ],
    [ "SET_LINE_CAP", "B" ],
    [ "SET_LINE_JOIN", "B" ],
    [ "SET_STROKE", "BBBB" ],
    [ "SET_STROKE_WIDTH", "f" ],
    [ "SET_LINE_WIDTH", "f" ],
    [ "SAVE", "" ],
    [ "RESTORE", "" ],
    [ "SET_LAYER", "B" ],
    [ "CALL", "L" ],
    [ "RET", "" ],
    [ "BEGIN", "" ],
    [ "END", "" ],
    [ "SCALE", "ff" ],
    [ "ROTATE", "f" ],
    [ "TRANSLATE", "ff" ],
    [ "RECT", "ffff" ],
    [ "FILL_RECT", "ffff" ],
    [ "MOVE", "ff" ],
    [ "LINE", "ff" ],
    [ "CURVE", "ffffff" ],
    [ "STROKE", "" ],
    [ "FILL", "" ],
    [ "GET_PIXELS", "LLLLLL" ],
    [ "PUT_PIXELS", "LLLLLL" ],
    [ "COPY_PIXELS", "LLLLLL" ],
    [ "PUT_IMAGE", "LLLLLLL" ]
];

GFX.LINE_CAPS = new Enum([
    "BUTT",
    "ROUND",
    "SQUARE"
]);

GFX.LINE_JOINS = new Enum([
    "BEVEL",
    "ROUND",
    "MITER"
]);

GFX.commands = {};
GFX.commands_by_name = {};

for(var i in GFX_COMMANDS) {
    var def = GFX_COMMANDS[i];
    var op = parseInt(i);
    var cmd = new GFX.Command(def[0], def[1]);
    GFX.commands[op] = cmd;
    GFX.commands_by_name[cmd.name] = cmd;
    GFX["CMD_" + cmd.name] = op;
}

GFX.StackOverflowError = 'Stack overflow';

GFX.ERRORS = {};
GFX.ERRORS[GFX.UnknownCommandError] = 1;
GFX.ERRORS[GFX.Command.ArgumentError] = 2;
GFX.ERRORS[RangedHash.InvalidAddressError] = 3;
GFX.ERRORS[GFX.StackOverflowError] = 4;

GFX.prototype.process_drawing_cmd = function()
{
    var ip = this.input_data.ip;
    var inc = 1;
    var off = this.input_data.ds.fields['input'].offset;
    var cmd = this.input_data.input[ip];

    if(ip >= this.input_data.input.byteLength) {
        return false;
    }

    if(this.debug == 2) {
        console.log("ip", ip, "cmd", cmd, GFX.commands[cmd], "RAM", this.input_ram.read(ip + off, 16), "SP", this.input_data.sp, "swap", this.input_data.swap, this.input_data.swapping);
    }

    if(this.context == null) {
        this.context = this.get_context('2d');
    }
    
    switch(cmd) {
    case GFX.CMD_NOP:
        break;
    case GFX.CMD_CLEAR:
        this.context.clearRect(0, 0, this.get_current_layer().width, this.get_current_layer().height);
        break;
    case GFX.CMD_SET_LAYER:
        this.set_layer(this.input_data.input[ip + 1]);
        this.context = this.get_context('2d');
        inc += 1;
        break;
    case GFX.CMD_SET_LINE_CAP:
        this.context.lineCap = GFX.LINE_CAPS[this.input_ram.read(ip + off + 1, 1)[0]].toLowerCase();
        inc += 1;
        break;
    case GFX.CMD_SET_LINE_JOIN:
        this.context.lineJoin = GFX.LINE_JOINS[this.input_ram.read(ip + off + 1, 1)[0]].toLowerCase();
        inc += 1;
        break;
    case GFX.CMD_SET_FILL:
        var c = Array.from(this.input_ram.read(ip + off + 1, 4));
        c[3] = c[3] / 255.0;
        this.context.fillStyle = 'rgba(' + c.join(',') + ')';
        inc += 4;
        break;
    case GFX.CMD_SET_STROKE:
        var c = Array.from(this.input_ram.read(ip + off + 1, 4));
        c[3] = c[3] / 255.0;
        this.context.strokeStyle = 'rgba(' + c.join(',') + ')';
        inc += 4;
        break;            
    case GFX.CMD_SET_LINE:
        var c = Array.from(this.input_ram.read(ip + off + 1, 4));
        c[3] = c[3] / 255.0;
        this.context.lineStyle = 'rgba(' + c.join(',') + ')';
        inc += 4;
        break;
    case GFX.CMD_SET_LINE_WIDTH:
        var c = this.input_ram.readf(ip + off + 1, 1);
        this.context.lineWidth = c[0];
        inc += VM.TYPES.FLOAT.byte_size;
        break;
    case GFX.CMD_SET_STROKE_WIDTH:
        var c = this.input_ram.readf(ip + off + 1, 1);
        this.context.strokeWidth = c[0];
        inc += VM.TYPES.FLOAT.byte_size;
        break;
    case GFX.CMD_SAVE:
        this.context.save();
        break;
    case GFX.CMD_RESTORE:
        this.context.restore();
        break;
    case GFX.CMD_BEGIN:
        this.context.beginPath();
        break;
    case GFX.CMD_END:
        this.context.closePath();
        break;
    case GFX.CMD_SCALE:
        var scale = this.input_ram.readf(ip + off + 1, 2);
        this.context.scale(scale[0], scale[1]);
        inc += VM.TYPES.FLOAT.byte_size * 2;
        break;
    case GFX.CMD_TRANSLATE:
        var dx = this.input_ram.readf(ip + off + 1, 2);
        this.context.translate(dx[0], dx[1]);
        inc += VM.TYPES.FLOAT.byte_size * 2;
        break;
    case GFX.CMD_ROTATE:
        var dx = this.input_ram.readf(ip + off + 1, 1);
        this.context.rotate(dx[0]);
        inc += VM.TYPES.FLOAT.byte_size;
        break;
    case GFX.CMD_FILL_RECT:
        var x = this.input_ram.readf(ip + off + 1, 4);
        this.context.fillRect(x[0], x[1], x[2], x[3]);
        inc += VM.TYPES.FLOAT.byte_size * 4;
        break;
    case GFX.CMD_RECT:
        var x = this.input_ram.readf(ip + off + 1, 4);
        this.context.rect(x[0], x[1], x[2], x[3]);
        inc += VM.TYPES.FLOAT.byte_size * 4;
        break;
    case GFX.CMD_MOVE:
        var x = this.input_ram.readf(ip + off + 1, 2);
        this.context.moveTo(x[0], x[1]);
        inc += VM.TYPES.FLOAT.byte_size * 2;
        break;
    case GFX.CMD_LINE:
        var x = this.input_ram.readf(ip + off + 1, 2);
        this.context.lineTo(x[0], x[1]);
        inc += VM.TYPES.FLOAT.byte_size * 2;
        break;
    case GFX.CMD_CURVE:
        var x = this.input_ram.readf(ip + off + 1, 6);
        this.context.bezierCurveTo(x[0], x[1], x[2], x[3], x[4], x[5]);
        inc += VM.TYPES.FLOAT.byte_size * 6;
        break;
    case GFX.CMD_STROKE:
        this.context.stroke();
        break;
    case GFX.CMD_FILL:
        this.context.fill();
        break;
    case GFX.CMD_CALL:
        inc += VM.TYPES.LONG.byte_size;
        this.input_data.ip += inc;
        this.call(this.input_ram.readL(ip + off + 1, 1)[0]);
        break;
    case GFX.CMD_RET:
        if(!this.call_return()) {
            return false;
        }
        break;
    case GFX.CMD_GET_PIXELS:
        inc += VM.TYPES.ULONG.byte_size * 6;
        var x = this.input_ram.readL(ip + off + 1, 6);
        var img = this.context.getImageData(x[0], x[1], x[2], x[3]);
        this.pixel_buffer.copy_image(img, 0, 0, x[4], x[5], x[2], x[3]);
        break;
    case GFX.CMD_PUT_PIXELS:
        inc += VM.TYPES.ULONG.byte_size * 6;
        var x = this.input_ram.readl(ip + off + 1, 6);
        this.pixel_buffer.put_pixels(this.context, x[0], x[1], x[2], x[3], x[4], x[5]);
        break;
    case GFX.CMD_COPY_PIXELS:
        inc += VM.TYPES.ULONG.byte_size * 6;
        var args = this.input_ram.readl(ip + off + 1, 6);
        this.pixel_buffer.copy_pixels(args[0], args[1], args[2], args[3], args[4], args[5]);
        break;
    case GFX.CMD_PUT_IMAGE:
        inc += VM.TYPES.ULONG.byte_size * 7;
        var x = this.input_ram.readl(ip + off + 1, 7);
        var n = x.shift();
        if(this.images[n]) {
            this.context.drawImage(this.images[n],
                                   x[2], x[3], x[4], x[5],
                                   x[0] + x[2], x[1] + x[3], x[4], x[5]);
        }
        break;
    default:
        this.write_error(GFX.UnknownCommandError, cmd);
        break;
    }

    if(cmd != GFX.CMD_CALL && cmd != GFX.CMD_RET) {
        if(this.debug == 2) console.log("IP += " + inc);
        this.input_data.ip += inc;
    }
    
    return true;
}

GFX.prototype.call = function(new_ip)
{
    if(this.input_data.sp < this.input_data.call_stack.length) {
        this.input_data.call_stack[this.input_data.sp++] = this.input_data.ip;
        this.input_data.ip = new_ip;
    } else {
        this.write_error(GFX.StackOverflowError, this.input_data.ip);
    }
}

GFX.prototype.call_return = function()
{
    if(this.input_data.sp > 0) {
        this.input_data.ip = this.input_data.call_stack[--this.input_data.sp];
        return true;
    } else {
        //this.stop_exec();
        return false;
    }
}

GFX.prototype.swap_buffers = function()
{
    if(this.debug) console.log("Swapping buffers", this.input_data.swapping, this.input_data.swap, this.timer);
    if(this.input_data.swapping == 0) {
        if(this.input_data.swap != 0) {
            if(this.debug) console.log("Commence swap");
            this.input_data.ip = this.input_data.swap - 1;
            this.input_data.swapping = this.input_data.swap;
            /*
      if(this.input_data.flags & (GFX.Flags.SYNC | GFX.Flags.RESYNC)) {
        this.request_animation();
      } else {
        this.run_anim();
      } 
*/
            
            return false;
        }
    }
    
    return this;
}

GFX.prototype.request_animation = function()
{
    if(this.debug) console.log("GFX request animation", this.timer, this.raf);
    /*
    if(this.timer == null) {
        this.raf = null;
        var self = this;
        this.timer = window.requestAnimationFrame(function(dt) {
          self.run_anim(dt);
        });
    } else {
        this.raf = true;
    }
*/
}

GFX.prototype.stop = function()
{
    if(this.timer) {
        window.cancelAnimationFrame(this.timer);
        this.timer = null;
        this.raf = null;
    }
    // if(this.timer.length > 0) {
    //     map_each(this.timer, function(t) {
    //         window.cancelAnimationFrame(t);
    //     });
    //     this.timer = [];
    // }
}

GFX.prototype.stop_exec = function()
{
    this.input_data.ip = 0;
    this.input_data.swapping = 0;
    this.input_data.swap = 0;

    this.trigger_interrupt();

    return this;
}

GFX.prototype.run_anim = function(dt)
{
    if(this.debug) console.log("GFX run_anim", dt, this.timer, this.raf, this.input_data.ip);
    
    this.timer = null;

    /*
    if((this.input_data.flags & GFX.Flags.RESYNC) || this.raf) {
        this.request_animation();
    }
  */

    var r;
    do {
        r = this.step_anim();
    } while(r != false);

    if(this.debug) console.log("GFX run_anim done", this.input_data.ip, this.input_data.last_error);
}

GFX.prototype.step = function()
{
    return this.step_anim();
}

GFX.prototype.trigger_interrupt = function()
{
    if(this.debug) console.log("GFX trigger interrupt");
    this.irq.trigger();
}

GFX.prototype.step_anim = function()
{
    if(this.input_data.swapping != 0) {
        try {
            if(this.process_drawing_cmd() != false) {
                return this;
            }
        } catch(err) {
            this.write_error(err, i);
        }

        this.stop_exec();
    }

    return false;
}

GFX.prototype.debug_dump = function()
{
    console.log("GFX", "layer", this.input_data.current_layer, "IP", this.input_data.ip, "SP", this.input_data.sp, "Swap", this.input_data.swap, this.input_data.swapping);
    return this;
}

GFX.BadLayerError = "Bad Layer";

GFX.prototype.set_layer = function(n)
{
    if(n < 0 || n >= this.layers.length) throw GFX.BadLayerError; 
    this.input_data.current_layer = n;
    return this;
}

GFX.prototype.get_context = function(type)
{
    return this.layers[this.input_data.current_layer].get_context(type);
}

GFX.prototype.get_current_layer = function()
{
    return this.layers[this.input_data.current_layer];
}

GFX.prototype.ram_size = function()
{
    return this.input_struct.byte_size + this.pixel_buffer.length;
}

GFX.prototype.read = function(addr, count, output, offset)
{
    if(addr < this.input_ram.length) {
        return this.input_ram.read(addr, count, output, offset);
    } else {
        return this.pixel_buffer.read(addr - this.input_ram.length, count, output, offset);
    }
}

GFX.prototype.write = function(addr, data)
{
    var n;
    if(addr < this.input_ram.length) {
        n = this.input_ram.write(addr, data);
        if(addr == this.input_struct.fields.swap.offset) {
            this.swap_buffers();
        }
    } else {
        n = this.pixel_buffer.write(addr - this.input_ram.length, data);
    }

    return n;
}

GFX.prototype.write_error = function(err, offset)
{
    var e = GFX.ERRORS[err];
    if(e) {
        this.input_data.last_error = err;
        this.input_data.error_offset = offset;
    } else {
        throw(err);
    }
}

GFX.prototype.writef = function(addr, v)
{
    var a = new Uint8Array(Float32Array.BYTES_PER_ELEMENT);
    var dv = new DataView(a.buffer, a.byteOffset);
    VM.TYPES.FLOAT.set(dv, 0, v);
    this.write(addr, a);
    return this;
}

GFX.prototype.write_resultf = function(result, a, b, c)
{
    this.input_data.result = result;
    this.input_data.result_values[0] = a;
    this.input_data.result_values[1] = b;
    this.input_data.result_values[2] = c;
    return this;
}

GFX.prototype.write_resultb = function(result, a, b, c)
{
    // todo actually write bytes or floats?
    this.input_data.result = result;
    this.input_data.result_values[0] = a;
    this.input_data.result_values[1] = b;
    this.input_data.result_values[2] = c;
    return this;
}

GFX.prototype.write_array = function(addr, arr) {
    return this.write(addr, GFX.encode_array(arr));
}

GFX.encode_array = function(arr, bytes) {
    if(!bytes) bytes = new Uint8Array(arr.length * VM.TYPES.LONG.byte_size);

    var bi = 0;
    for(var i = 0; i < arr.length; i++) {
        var cmd = GFX.commands[arr[i]];
        if(cmd == null) throw "Undefined: " + arr + " " + i;
        bytes[bi] = arr[i];
        bi += 1;
        bi += cmd.encode_array(arr.slice(i + 1, i + 1 + cmd.arity), new DataView(bytes.buffer, bytes.byteOffset + bi));
        i += cmd.arity;
    }

    return bytes.subarray(0, bi);
}

function gfx_test_cmds(r, g, b)
{
    return [
        GFX.CMD_SET_LAYER, 0,
        GFX.CMD_CLEAR,
        GFX.CMD_SET_LINE_CAP, GFX.LINE_CAPS.ROUND,
        GFX.CMD_SET_FILL, r, g, b, 255,
        GFX.CMD_FILL_RECT, 0, 0, 640, 480,
        GFX.CMD_SET_STROKE, 0, 255, 0, 255,
        GFX.CMD_SET_LINE, 255, 0, 0, 255,
        GFX.CMD_SET_LINE_WIDTH, 5,
        GFX.CMD_BEGIN,
        GFX.CMD_MOVE, 0, 0,
        GFX.CMD_LINE, 320, 240,
        GFX.CMD_LINE, 320, 0,
        GFX.CMD_STROKE,
        GFX.CMD_BEGIN,
        GFX.CMD_MOVE, 100, 0,
        GFX.CMD_SET_STROKE, 0, 0, 255, 128,
        GFX.CMD_SET_LINE_WIDTH, 10,
        GFX.CMD_LINE, 480, 320,
        GFX.CMD_CURVE, 0, 480, 0, 0, 640, 480,
        GFX.CMD_STROKE,
        GFX.CMD_RET
    ];
}

GFX.video_test_layers = function(video, target, cycles)
{
    var set_layer = [
        GFX.CMD_CLEAR,
        GFX.CMD_SET_LAYER, target,
        GFX.CMD_SCALE, 0.5, 0.5,
    ];

    video.input_data.layers[target].z = 1;
    video.input_data.layers[target].x = 640 * 0.25;
    video.input_data.layers[target].y = 480 * 0.25;
    video.input_data.layers[target].width = 320;
    video.input_data.layers[target].height = 240;
    video.input_data.layers[target].alpha = 0.5;
    video.write_array(video.input_data.ds.fields['input'].offset, set_layer.concat(gfx_test_cmds(255, 0, 0)));
    video.write(video.input_data.ds.fields['swap'].offset, [ 1, 0, 0, 0]);
    //video.input_data.swap = 1;
    //video.writef(GFX.INPUT_LAYERS + GFX.INPUT_LAYER_ALPHA, 0.5);

    if(!cycles) cycles = 100;
    util.n_times(cycles, function(n) {
        video.step();
    });
}

GFX.video_test_pixels = function(video, cycles)
{
    var width = video.pixel_buffer.width;
    var height = video.pixel_buffer.height;
    var channels = 4;
    
    var solid_pixels = [
        GFX.CMD_SET_LAYER, 0,
        GFX.CMD_CLEAR,
        GFX.CMD_PUT_PIXELS, 64, 64, 0, 0, 64, 64,
        GFX.CMD_PUT_PIXELS, 320, 32, 0, 0, 64, 64,
        GFX.CMD_RET
    ];

    var get_pixels = [
        GFX.CMD_SAVE,
        GFX.CMD_GET_PIXELS, 0, 0, width, height, 0, 0,
        GFX.CMD_CLEAR,
        GFX.CMD_PUT_PIXELS, 320, 32, 0, 0, width/2, height/2,
        GFX.CMD_RESTORE,
        GFX.CMD_RET
    ];

    var pixels = [];
    for(var x = 0; x < 64 * channels; x += channels) {
        pixels[x] = 255;
        pixels[x+1] = 0;
        pixels[x+2] = 0;
        pixels[x+3] = 128;
    }
    
    for(var row = 0; row < 64; row++) {
        var addr = video.input_struct.byte_size + row * width * channels;
        console.log("Writing pixels to " + addr);
        video.write(addr, pixels);
    }

    var off = video.input_data.ds.fields['input'].offset;
    var get_pixels_off = video.write_array(off, solid_pixels);
    off += get_pixels_off;
    off += video.write_array(off, get_pixels);
    
    console.log("Swapping");
    //video.input_data.swap = 1;
    video.write(video.input_data.ds.fields['swap'].offset, [ 1, 0, 0, 0]);

    setTimeout(function() {
        if(video.input_data.swapping == 0) {
            console.log("Step", get_pixels_off);
            video.write(video.input_data.ds.fields['swap'].offset, [ 1 + get_pixels_off, 0, 0, 0]);
        }
    }, 1000);
    /*
  do {
    console.log("Step");
    video.step();
  } while(video.input_data.swapping != 0);
*/
    /*
  util.n_times(cycles, function(n) {
    video.step_anim();
  });
*/
}

GFX.video_test = function(canvas, cycles)
{
    if(canvas.constructor != Array) canvas = [ canvas ];
    var video = new GFX(null, 8, canvas, 640, 480, 4096);

    // todo stored drawings: bitmap, offscreen canvas
    // todo every device needs a step: rename VM to CPU and have a VM to step everything
    // todo pixel access?
    // todo canvas resizing events
    var cmd_arr = GFX.encode_array(gfx_test_cmds(0, 0, 128));
    video.write(video.input_data.ds.fields['input'].offset, cmd_arr);
    //video.write_array(video.input_data.ds.fields['input'].offset, gfx_test_cmds(0, 0, 128));
    console.log("Command byte length", cmd_arr.byteLength);
    console.log("Setting swap to 1");
    video.write(video.input_data.ds.fields['swap'].offset, [ 1, 0, 0, 0]);
    //video.input_data.swap = 1;
    /*
  console.log("Stepping");
  do {
        video.step();
    } while(video.input_data.swapping != 0);
*/
    
    return video;
}

GFX.video_test_call = function(video)
{
    var call_cmds = [
        GFX.CMD_SAVE,
        GFX.CMD_TRANSLATE, 10.0, 0.0,
        GFX.CMD_CALL, 27,
        GFX.CMD_ROTATE, Math.PI / 8.0,
        GFX.CMD_CALL, 27,
        GFX.CMD_ROTATE, Math.PI / 8.0,
        GFX.CMD_CALL, 27,
        GFX.CMD_RESTORE,
        GFX.CMD_RET
    ];
    var cmd_arr = GFX.encode_array(gfx_test_cmds(0, 128, 128));
    var off = video.input_data.ds.fields['input'].offset;
    video.write(off, cmd_arr);
    off += cmd_arr.byteLength;
    video.write(off, GFX.encode_array(call_cmds));
    
    video.input_data.swap = cmd_arr.byteLength + 1;
    // trip the write callbacks
    video.write(video.input_data.ds.fields['swap'].offset, cmd_arr.byteLength + 1);
    
    return video;
}

if((typeof(window) != 'undefined' && !window['VM']) ||
   (typeof(global) != 'undefined' && !global['VM'])) {
    VM = {};
}
if(typeof(VM.Devices) == 'undefined') {
    VM.Devices = {};
}
VM.Devices.GFX = GFX;

if(typeof(module) != 'undefined') {
	module.exports = GFX;
}
