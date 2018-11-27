require('vm');

function RegisterTable(el)
{
    this.elements = [];
    this.hook(el);
}

RegisterTable.prototype.hook = function(el) {
    var table = document.getElementById('register-table');
    var template = table.getElementsByClassName('template')[0];
    template.remove();
    
    for(var i = 0; i < 16; i++) {
        var tr = template.cloneNode(true);
        table.appendChild(tr);
        
        var name = tr.getElementsByClassName('name')[0];
        name.innerText = VM.CPU.REGISTER_NAMES[i] || i.toString(16);
        
        var value = tr.getElementsByClassName('value-hex')[0];
        value.id = "register-hex-" + i;

        var dec_value = tr.getElementsByClassName('value-dec')[0];
        dec_value.id = "register-dec-" + i;
        tr.appendChild(dec_value);

        this.elements[i] = [ value, dec_value ];
    }
}

RegisterTable.prototype.update = function(vm)
{
    for(var i = 0; i < 16; i++) {
        var elements = this.elements[i];
        var value = vm.cpu.regread(i);
        elements[0].innerText = value.toString(16);

        if(i == VM.CPU.REGISTERS.INS) {
            var ins = vm.cpu.decode(value);
            var text = " " + ins.name;
            elements[1].innerText = text;
        } else if(i == VM.CPU.REGISTERS.STATUS) {
            var text = "";
            for(var flag in VM.CPU.STATUS) {
                var bit = VM.CPU.STATUS[flag];
                if(value & bit) {
                    text += " " + flag;
                }   
            }
            elements[1].innerText = text;
        } else {
            elements[1].innerText = value.toString(10);
        }
    }
}

if(typeof(module) != 'undefined') {
    module.exports = RegisterTable;
}
