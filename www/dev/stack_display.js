require('vm');

function StackDisplay(parent, size)
{
    this.stack_elements = [];
    this.hook(parent, size);
}

StackDisplay.prototype.hook = function(parent, size)
{
    var source = document.getElementById('stack-table');
    var slot_template = source.getElementsByClassName('slot-template')[0];
    slot_template.remove();
    
    this.stack_size = {
        hex: document.getElementById('stack-size-hex'),
        dec: document.getElementById('stack-size-dec'),
        slots: document.getElementById('stack-size-slots')
    };
    
    for(var i = 0; i < size; i++) {
        var tr = slot_template.cloneNode(true);
        var offset = tr.getElementsByClassName('offset')[0];
        offset.id = 'stack-offset-' + i;
        offset.innerText = i;

        var addr = tr.getElementsByClassName('address')[0];
        addr.id = 'stack-address-' + i;

        var hex_value = tr.getElementsByClassName('value-hex')[0];
        hex_value.id = 'stack-hex-value-' + i;

        var dec_value = tr.getElementsByClassName('value-dec')[0];
        dec_value.id = 'stack-dec-value-' + i;

        source.appendChild(tr);
        this.stack_elements[i] = [ addr, hex_value, dec_value ];
    }
}

StackDisplay.prototype.update = function(vm)
{
    var sp = vm.cpu.regread('sp');

    this.stack_size.slots.innerText = ((vm.cpu.stack_start - sp) / VM.TYPES.ULONG.byte_size).toString(10);
    this.stack_size.hex.innerText = (vm.cpu.stack_start - sp).toString(16);
    this.stack_size.dec.innerText = (vm.cpu.stack_start - sp).toString(10);
    
    for(var i = 0; i < this.stack_elements.length; i++) {
        var elements = this.stack_elements[i];
        var addr = sp + i * VM.CPU.REGISTER_SIZE;
        elements[0].innerText = addr.toString(16).padStart(8, '0');
        
        try {
            var value = vm.cpu.memreadL(addr);
            elements[1].innerText = value.toString(16).padStart(8);
            elements[2].innerText = value.toString(10).padStart(8);
        } catch(e) {
            elements[1].innerText = "";
            elements[2].innerText = "";
        }
    }
}

if(typeof(module) != 'undefined') {
    module.exports = StackDisplay;
}
