const VM = require("vm.js");
const Xterm = require('xterm');
const Colors = require('colors/safe');
const util = require('more_util');
const InputStream = require('vm/node/devices/input_stream');
const OutputStream = require('vm/node/devices/output_stream');
const TextDecoder = require('util/text_decoder');
const TextEncoder = require('util/text_encoder');

function Terminal(element, term_opts)
{
    Colors.enabled = true;

    term_opts = util.merge_options({
      cursorBlink: true,
      local_echo: true
    }, term_opts);
    
  this.term = new Xterm.Terminal(term_opts);
  this.local_echo = term_opts.local_echo;
    this.buffer = "";
    var self = this;
    this.on_terminal('data', function(c) {
        self.push_byte(c);
        if(c == '\r') self.push_byte('\n');
    });
    this.term.open(element);
}

Terminal.prototype.on_terminal = function(event, fn)
{
    return this.term.on(event, fn);
}

Terminal.prototype.push_byte = function(data)
{
  if(this.debug) console.log("Terminal push", data, data.charCodeAt(0));
  if(data == "\x7F" || data == "\x08") {
    this.buffer = this.buffer.slice(0, this.buffer.length - 1);
  } else {
    this.buffer += data;
  }
  
  if(this.local_echo) {
    if(data == "\x7F" || data == "\x08") {
      data = "\x08 \x08";
    }
    this.write(data);
  }

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
  if(this.debug) console.log("Terminal write:", data, data.split(''));
  this.term.write(data);
  return this;
}

Terminal.Readable = function(terminal)
{
    this.terminal = terminal;
    this.encoder = new TextEncoder();
    this.callbacks = [];

    var self = this;

  this.terminal.on_terminal('data', function(c) {
    if(c.charCodeAt(0) < 32) {
      self.on_data();
    }
  });
}

Terminal.Readable.prototype.pause = function()
{
  this.is_paused = true;
  return this;
}

Terminal.Readable.prototype.resume = function()
{
  this.is_paused = false;
  return this;
}

Terminal.Readable.prototype.on = function(event, fn)
{
  this.callbacks[event] = fn;
  if(event == 'readable') {
    if(this.debug) console.log("Terminal calling readable", this.terminal.buffer);
    fn();
  }
    return this;
}

Terminal.Readable.prototype.on_data = function()
{
  if(!this.is_paused) {
    var data = this.read();
    var cb = this.callbacks['data'];
    if(cb) cb(data);
  }
}

Terminal.Readable.prototype.read = function(amount)
{
    var line = this.terminal.read(amount);
    return this.encoder.encode(line);
}

Terminal.Readable.prototype.readableLength = function()
{
    return this.terminal.readableLength();
}


Terminal.Writable = function(terminal)
{
    this.decoder = new TextDecoder();
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
  if(typeof(data) != 'string') {
    data = this.decoder.decode(data, { stream: data.length != 0 });
  }
  this.terminal.write(data);
  if(callback) setTimeout(callback, 1); // Writeables expect an async callback
  return this;
}

Terminal.Writable.prototype.end = function()
{
    this.write(""); // flush the decoder
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

Terminal.prototype.clear = function()
{
  this.term.clear();
}

if(typeof(module) != 'undefined') {
    module.exports = Terminal;
}
if(typeof(VM) != 'undefined') {
    VM.Terminal = Terminal;
}

