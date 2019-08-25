require('vm/types.js');
const DataStruct = require('data_struct.js');
const Enum = require('enum.js');
const RAM = require('vm/devices/ram.js');

function KeyStore(storage, memory, irq, name)
{
  this.name = name || 'KeyStore';
  this.storage = storage;
  this.memory = memory;
  this.irq = irq;
  this.ram = new RAM(KeyStore.Struct.byte_size);
  this.state = KeyStore.Struct.proxy(this.ram.data_view());
  this.reset();
}

KeyStore.Status = new Enum([
  [ "NONE", 0 ],
  [ "OK", 1 ],
  [ "NOT_FOUND", 2 ],
  [ "BUSY", 4 ],
  [ 'ERROR', 0x80 ],
  [ "BAD_COMMAND", (0x80 | 2) ]
]);

KeyStore.Command = new Enum([
  [ "NONE", 0 ],
  [ "ENABLE", 1 ],
  [ "DISABLE", 2 ],
  [ "RESET", 3 ],
  [ "STAT", 4 ],
  [ "READ", 5 ],
  [ "WRITE", 6 ],
  [ "DELETE", 7 ],
  [ "NUMBER", 8 ]
]);

KeyStore.Struct = new DataStruct([
  [ 'status', VM.TYPES.ULONG ],
  [ 'command', VM.TYPES.ULONG ],
  [ 'offset', VM.TYPES.ULONG ],
  [ 'key', VM.TYPES.ULONG ],
  [ 'key_size', VM.TYPES.ULONG ],
  [ 'data_pointer', VM.TYPES.ULONG ],
  [ 'data_size', VM.TYPES.ULONG ],
  [ 'data_out_pointer', VM.TYPES.ULONG ],
  [ 'data_out_size', VM.TYPES.ULONG ]
]);

KeyStore.prototype.ram_size = function()
{
  return this.ram.length;
}

KeyStore.prototype.reset = function()
{
  this.ram.set(0, this.ram.length, 0);

  this.state.status = KeyStore.Status.BUSY;
  this.storage.disable((err) => {
    if(err) {
      this.state.status = KeyStore.Status.ERROR;
    } else {
      this.state.status = KeyStore.Status.NONE;
    }
  });
}

KeyStore.prototype.read = function(addr, count, output, offset)
{
    return this.ram.read(addr, count, output, offset);
}

KeyStore.prototype.read_key = function()
{
  return this.memory.memread(this.state.key, this.state.key_size);
}

KeyStore.prototype.process_command = function()
{
  if(this.debug) console.log('KeyStore command', this.state.command, KeyStore.Command[this.state.command], this.state.status);
  var cmd = KeyStore.Commands[this.state.command];
  if(cmd == null) cmd = KeyStore.Commands[KeyStore.Command.NUMBER];
  return cmd.call(this);
}

KeyStore.Commands = {};

KeyStore.Commands[KeyStore.Command.NONE] = function()
{
  if(this.state.status == KeyStore.Status.BUSY) return this;
  this.state.status = KeyStore.Status.OK;
  this.state.command = 0;
  return this;
}

KeyStore.Commands[KeyStore.Command.NUMBER] = function()
{
  if(this.state.status == KeyStore.Status.BUSY) return this;
  this.state.status = KeyStore.Status.BAD_COMMAND;
  this.state.command = 0;
  return this;
}

KeyStore.Commands[KeyStore.Command.DELETE] = function()
{
  if(this.state.status == KeyStore.Status.BUSY) return this;
  this.state.status = KeyStore.Status.BUSY;

  var key = this.read_key();
  this.storage.removeItem(key, (new_key, state) => {
    this.state.status = state ? KeyStore.Status.OK : KeyStore.Status.ERROR;
    this.state.command = 0;
    this.irq.trigger();
  });

  return this;
}

KeyStore.Commands[KeyStore.Command.WRITE] = function()
{
  if(this.state.data_out_size > 0) {
    if(this.state.status == KeyStore.Status.BUSY) return this;
    this.state.status = KeyStore.Status.BUSY;

    var key = this.read_key();
    var data = this.memory.memread(this.state.data_out_pointer, this.state.data_out_size);
    if(this.debug) console.log("Write", key, data);
    this.storage.setItem(key, data, (new_key, success) => {
      this.state.status = success ? KeyStore.Status.OK : KeyStore.Status.ERROR;
      this.state.command = 0;
      if(success) {
        var key_size = Math.min(new_key.length, this.state.data_size);
        if(this.debug) console.log("Wrote", new_key, success, key_size, this.state.status, this.irq);
        this.memory.memwrite(this.state.data_pointer, new_key.slice(0, key_size));
        this.state.data_size = key_size;
      }
      this.irq.trigger();
    });
  } else {
    KeyStore.Commands[KeyStore.Command.DELETE].call(this);
  }

  return this;
}

KeyStore.Commands[KeyStore.Command.READ] = function()
{
  if(this.state.status == KeyStore.Status.BUSY) return this;
  this.state.status = KeyStore.Status.BUSY;
  
  var key = this.read_key();
  var value = this.storage.getValue(key, this.state.offset, this.state.data_size, (read_key, data) => {
    if(this.debug) console.log("Read", key, read_key, data ? data.length : 0, this.state.offset, this.state.data_size, data);
    this.state.command = 0;
    if(data != null) {
      var size = Math.min(data.length, this.state.data_size);
      this.memory.memwrite(this.state.data_pointer, data.slice(0, size));
      this.state.data_size = size;
      this.state.status = KeyStore.Status.OK;
    } else {
      this.state.data_size = 0;
      this.state.status = KeyStore.Status.NOT_FOUND | KeyStore.Status.ERROR;
    }
    this.irq.trigger();
  });

  return this;
}

KeyStore.Commands[KeyStore.Command.STAT] = function()
{
  if(this.state.status == KeyStore.Status.BUSY) return this;
  this.state.status = KeyStore.Status.BUSY;

  var key = this.read_key();
  var data = this.storage.getSize(key, (read_key, size) => {
    this.state.command = 0;
    if(size != null) {
      this.state.data_size = size;
      this.state.status = KeyStore.Status.OK;
    } else {
      this.state.data_size = 0;
      this.state.status = KeyStore.Status.NOT_FOUND | KeyStore.Status.ERROR;
    }
    this.irq.trigger();
  });
  return this;
}

KeyStore.Commands[KeyStore.Command.ENABLE] = function()
{
  if(this.state.status == KeyStore.Status.BUSY) return this;
  this.state.status = KeyStore.Status.BUSY;

  this.storage.enable((err) => {
    this.state.command = 0;
    if(err) {
      this.state.status = KeyStore.Status.ERROR;
    } else {
      this.state.status = KeyStore.Status.OK;
    }
    this.irq.trigger();
  });
  return this;
}

KeyStore.Commands[KeyStore.Commands.DISABLE] = function()
{
  if(this.state.status == KeyStore.Status.NONE) return this;
  this.state.status = KeyStore.Status.BUSY;

  this.storage.disable((err) => {
    this.state.command = 0;
    if(err) {
      this.state.status = KeyStore.Status.ERROR;
    } else {
      this.state.status = KeyStore.Status.NONE;
    }
    this.irq.trigger();
  });
  return this;
}

function in_range(n, min, max)
{
  if(n >= min && n < max) { return true; }
  else { return false; }
}

KeyStore.prototype.write = function(addr, data)
{
  var n = this.ram.write(addr, data);
  if(in_range(this.state.ds.fields.command.offset, addr, addr + data.length)) this.process_command();
  return n;
}

if(typeof(module) != 'undefined') {
	module.exports = KeyStore;
}
if(typeof(VM) != 'undefined') {
    VM.LocalKeyStore = KeyStore;
}
