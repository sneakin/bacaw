"use strict";

const DataStruct = require('data_struct.js');
const VMJS = require('vm.js');
const RAM = require('vm/devices/ram.js');

var now, start_time;

if(typeof(performance) != 'undefined') {
    now = function() {
        return performance.now();
    }

    start_time = function() {
        return performance.timing.navigationStart;;
    }
} else {
    now = function() {
        return Date.now();
    }

    var start = now();
    start_time = function() {
        return start;
    }
}

function RTC()
{
    this.name = 'RTC';
    this.input_ram = new RAM(RTC.InputMemory.byte_size);
    this.input_data = RTC.InputMemory.proxy(this.input_ram.data_view());
    this.input_data.on_time = start_time();
}

RTC.InputMemory = new DataStruct([
    [ 'calendar_ms', VM.TYPES.ULONG ],
    [ 'on_time', VM.TYPES.FLOAT ],
    [ 'runtime_usec', VM.TYPES.ULONG ],
    [ 'runtime_ms', VM.TYPES.FLOAT ],
    [ 'runtime_sec', VM.TYPES.ULONG ]
]);

RTC.prototype.ram_size = function()
{
    return this.input_ram.length;
}

RTC.prototype.read = function(addr, count, output, offset)
{
    return this.input_ram.read(addr, count, output, offset);
}

RTC.prototype.read1 = function(addr, type)
{
    this.update();
    return this.input_ram.read1(addr, type);
}

RTC.prototype.update = function()
{
    var t = now();
    this.input_data.runtime_ms = t;
    this.input_data.runtime_usec = (t * 1000)|0;
    this.input_data.runtime_sec = (t / 1000)|0;
    this.input_data.calendar_ms = Date.now();
}

if(typeof(module) != 'undefined') {
    module.exports = RTC;
}
