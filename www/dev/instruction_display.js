require('vm');

function InstructionDisplay(vm, num_rows)
{
    this.vm = vm;
    this.row_count = num_rows || 16;
    this.rows = new Array(this.row_count);

    this.backlog = Math.floor(this.row_count / 2);
    
    var self = this;
    this.offset_input = document.getElementById('instructions-offset');
    this.offset_input.onchange = function() {
        self.set_offset(parseInt(self.offset_input.value), true);
    }

    this.show_op_args_input = document.getElementById('instructions-show-args');
    this.show_op_args_input.onchange = function() {
        self.update_rows();
    };

    this.follow_input = document.getElementById('instructions-follow');
    this.follow_input.onchange = function() {
        self.update();
    };

    var table = document.getElementById('instructions-table');
    var template = table.getElementsByClassName('template')[0];
    template.remove();

    for(var i = 0; i < this.row_count; i++) {
        var row = template.cloneNode(true);
        table.appendChild(row);

        this.rows[i] = [ row,
                         row.getElementsByClassName('address')[0],
                         row.getElementsByClassName('memory')[0],
                         row.getElementsByClassName('instruction')[0]
                       ];
    }

    this.set_offset(vm.cpu.regread('ip'));
}

InstructionDisplay.prototype.set_offset = function(addr, from_input)
{
    this.offset = addr;
    if(!from_input) this.offset_input.value = addr.toString(16).padStart(8, '0');
    return this.update_rows();
}

InstructionDisplay.prototype.set_show_args = function(yes)
{
    this.show_op_args_input.checked = yes;
}

InstructionDisplay.prototype.update = function()
{
    if(this.follow_input.checked) {
        var ip = this.offset;
        ip = vm.cpu.regread('ip') - this.backlog * VM.CPU.INSTRUCTION_SIZE;
        this.offset_input.value = ip.toString(16).padStart(8, '0');
        return this.set_offset(ip);
    }
}

InstructionDisplay.prototype.update_rows = function()
{
    var ip = this.offset;
    var real_ip = this.vm.cpu.regread('ip');
    
    for(var i = 0; i < this.row_count; i++) {
        var row = this.rows[i];
        var op = this.read_op(ip);
        var inst = this.decode(op);
        
        if(real_ip == ip) {
            row[0].classList.add('current');
        } else {
            row[0].classList.remove('current');
        }

        var addr = ip.toString(16).padStart(8, '0');
        var bytes = op.toString(16).padStart(4, '0');
        var decomp = this.op_string(op, inst);

        ip += VM.TYPES.SHORT.byte_size;

        if(inst.has_literal) {
            var data = this.read_data(ip, inst.has_literal);
            bytes += " " + data.toString(16).padStart(8, '0');
            decomp += ', ' + data.toString(10);

            ip += inst.has_literal.byte_size;
        }

        row[1].innerText = addr;
        row[2].innerText = bytes;
        row[3].innerText = decomp;
    }
    
    return this;
}

InstructionDisplay.prototype.read_op = function(addr)
{
    try {
        return this.vm.mmu.memreadS(addr);
    } catch(e) {
        if(!(e instanceof VM.MMU.NotMappedError)) throw(e);
        return 0;
    }
}

InstructionDisplay.prototype.decode = function(op)
{
    try {
        return this.vm.cpu.decode(op);
    } catch(e) {
        return "Error decoding";
    }
}

InstructionDisplay.prototype.op_string = function(op, inst)
{
    try {
        var str = "" + inst.name;

        var args = inst.unmask(op);
        var more = [];
        for(var k in inst.arg_masks) {
            var s = "";
            if(this.show_op_args_input.checked) {
                s += inst.arg_masks[k].name + ": ";
            }
            s += args[k];

            more.push(s);
            if(k == 'lowop') break;
        }
        return str + '(' + more.join(', ') + ")";
    } catch(e) {
        return e;
    }
}

InstructionDisplay.prototype.op_has_data = function(op)
{
    return false;
}

InstructionDisplay.prototype.read_data = function(addr, type)
{
    try {
        return this.vm.mmu.memread(addr, type);
    } catch(e) {
        if(!(e instanceof VM.MMU.NotMappedError)) throw(e);
        return 0;
    }
}

if(typeof(module) != 'undefined') {
    module.exports = InstructionDisplay;
}
