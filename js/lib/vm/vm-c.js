require('vm.js');

function vm_generate_c_register_classes()
{
    var s = [];
    
    for(var i = 0; i < VM.CPU.REGISTERS.SP; i++) {
        var c = "RC_INT | RC_FLOAT | RC_R" + i;
        if(i % 2 == 1) {
            c = c + " | RC_INT_BSIDE"
        }
        s.push(c);
    }
    for(var i = VM.CPU.REGISTERS.SP; i < VM.CPU.REGISTER_COUNT; i++) {
        s.push("RC_R" + i);
    }
    
    return "ST_DATA const int reg_classes[NB_REGS] = {\n" + s.join(",\n") + "\n};";
}

function vm_generate_c_register_class_names()
{
    var regs = [];
    
    for(var i in VM.CPU.REGISTERS) {
        var n = VM.CPU.REGISTERS[i];
        if(!regs[n]) {
            regs[n] = i;
        }
    }

    var s = map_each_n(regs, function(r, n) {
        return "#define RC_" + r + "\t0x" + (1 << (n + 2)).toString(16);
    });
    for(var i = 0; i < VM.CPU.REGISTER_COUNT; i++) {
        s.push("#define RC_R" + i + "\t0x" + (1 << (i + 2)).toString(16));
    }
    return s.sort().join("\n");
}

function vm_generate_c_registers()
{
    var regs = [];
    
    for(var i in VM.CPU.REGISTERS) {
        var n = VM.CPU.REGISTERS[i];
        if(!regs[n]) {
            regs[n] = i;
        }
    }

    var s = map_each_n(regs, function(r, n) {
        return "#define BC_REG_" + r + "\t0x" + n.toString(16);
    });
    for(var i = 0; i < VM.CPU.REGISTER_COUNT; i++) {
        s.push("#define BC_REG_R" + i + "\t0x" + i.toString(16));
    }
    return s.sort().join("\n");
}

function each_ins(ins_list, f, acc)
{
    if(!acc) acc = [];
    if(!ins_list) ins_list = VM.CPU.INS_DISPATCH;

    var max = ins_list.max;
    for(var i = 0; i <= max; i++) {
        try {
            var inst = ins_list.get(ins_list.mask_op(i));
            if(inst.name) {
                acc.push(f(inst));
            } else if(inst.mask) {
                each_ins(inst, f, acc);
            }
        } catch(e) {
            if(e != DispatchTable.UnknownKeyError) throw(e);
        }
    }

    return acc;
}

function vm_generate_c_ops()
{
    return each_ins(VM.CPU.INS_DISPATCH, function(ins, n) {
        return "#define BC_OP_" + ins.name + "\t0x" + ins.op.toString(16);
    }).sort().join("\n");
}

function vm_generate_c_header()
{
    return [ "#ifndef BACAW_VM_H",
             "#define BACAW_VM_H",
             "",
             "#define NB_REGS\t" + VM.CPU.REGISTER_COUNT,
             "",
             vm_generate_c_registers(),
             "",
             vm_generate_c_register_class_names(),
             "",
             vm_generate_c_register_classes(),
             "",
             vm_generate_c_ops(),
             "",
             "#endif /* BACAW_VM_H_ */"
           ].join("\n");
}
