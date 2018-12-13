const VM = require("vm.js");
const Xterm = require('xterm');
const Colors = require('colors/safe');
const util = require('more_util');
const InputStream = require('vm/node/devices/input_stream');
const OutputStream = require('vm/node/devices/output_stream');

function Terminal(element, term_opts)
{
    Colors.enabled = true;

    term_opts = util.merge_options({
        cursorBlink: true
    }, term_opts);
    
    this.term = new Xterm.Terminal(term_opts);
    this.buffer = "";
    var self = this;
    this.on_terminal('data', function(c) {
        self.push_byte(c);
        if(c == '\r') self.push_byte('\n');
    });
    this.term.open(element);
    this.term.writeln(Colors.red("Hello!"));
}

Terminal.prototype.on_terminal = function(event, fn)
{
    return this.term.on(event, fn);
}

Terminal.prototype.push_byte = function(data)
{
    if(this.debug) console.log("Terminal push", data);
    this.buffer += data;
    return this;
}

Terminal.prototype.read = function(amount)
{
    if(amount == null) amount = this.buffer.length;
    var r = this.buffer.substring(0, amount);
    if(this.debug) console.log("Terminal", amount, r, this.buffer);
    this.buffer = this.buffer.substring(amount);
    return r;
}

Terminal.prototype.readableLength = function()
{
    return this.buffer.length;
}

Terminal.prototype.write = function(data)
{
    this.term.write(data);
    return this;
}

Terminal.Readable = function(terminal)
{
    this.terminal = terminal;
    this.callbacks = [];

    var self = this;
    this.terminal.on_terminal('data', function(c) {
        if(c == "\r" || c == "\n") {
            if(this.debug) console.log("Terminal calling readable", c, self.terminal.buffer);
            var cb = self.callbacks['readable'];
            if(cb) cb();
        }
    });
}

Terminal.Readable.prototype.pause = function()
{
    return this;
}

Terminal.Readable.prototype.on = function(event, fn)
{
    this.callbacks[event] = fn;
    return this;
}

Terminal.Readable.prototype.read = function(amount)
{
    return this.terminal.read(amount);
}

Terminal.Readable.prototype.readableLength = function()
{
    return this.terminal.readableLength();
}


Terminal.Writable = function(terminal)
{
    this.terminal = terminal;
    this.callbacks = [];
}

Terminal.Writable.prototype.on = function(event, fn)
{
    this.callbacks[event] = fn;
    return this;
}

Terminal.Writable.prototype.write = function(data, encoding, callback)
{
    this.terminal.write(data);
    if(callback) setTimeout(callback, 1); // Writeables expect an async callback
    return this;
}

Terminal.Writable.prototype.end = function()
{
    return this;
}

Terminal.prototype.get_readable = function()
{
    return new Terminal.Readable(this);
}

Terminal.prototype.get_input_device = function(mem_size, vm, irq)
{
    return new InputStream(this.get_readable(), mem_size, vm, irq);
}

Terminal.prototype.get_writable = function()
{
    return new Terminal.Writable(this);
}

Terminal.prototype.get_output_device = function(mem_size, vm, irq)
{
    return new OutputStream(this.get_writable(), mem_size, vm, irq);
}

if(typeof(module) != 'undefined') {
    module.exports = Terminal;
}
if(typeof(VM) != 'undefined') {
    VM.Terminal = Terminal;
}

