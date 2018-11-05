const DispatchTable = require('vm/dispatch_table.js');
const util = require('util.js');
require('vm.js');

function html_append(el, o)
{
    if(typeof(o) == 'object') {
        el.appendChild(o);
    } else {
        el.innerHTML = o;
    }
}

function html_table(arr, row_headings, col_headings)
{
    var el = document.createElement("table");

    if(col_headings) {
        var tr = document.createElement('tr');
        var td = document.createElement('td');
        tr.appendChild(td);
        el.appendChild(tr);

        for(var col = 0; col < col_headings.length; col++) {
            var td = document.createElement('td');
            tr.appendChild(td);
            html_append(td, col_headings[col]);
        }
    }
    
    for(var row = 0; row < arr.length; row++) {
        var data = arr[row];
        var tr = document.createElement('tr');
        el.appendChild(tr);

        if(row_headings && row_headings[row]) {
            var td = document.createElement('td');
            html_append(td, row_headings[row]);
            tr.appendChild(td);
        }
        
        for(var col = 0; col < data.length; col++) {
            var td = document.createElement('td');
            html_append(td, data[col]);
            tr.appendChild(td);
        }
    }
    
    return el;
}

function html_attr_table(o)
{
    var dl = document.createElement('table');
    
    for(var i in o) {
        var tr = document.createElement('tr');
        dl.appendChild(tr);
        
        var dt = document.createElement('th');
        dt.textContent = i;
        tr.appendChild(dt);
        var dd = document.createElement('td');
        dd.textContent = o[i];
        tr.appendChild(dd);
    }

    return dl;
}

function html_dl(o)
{
    var dl = document.createElement('dl');
    for(var key in o) {
        var dt = document.createElement('dt');
        html_append(dl, key);
        dl.appendChild(dt);
        
        var dd = document.createElement('dd');
        html_append(dd, o[key]);
        dl.appendChild(dd);
    }
    return dl;
}

function html_dl_arr(o)
{
    var dl = document.createElement('dl');
    for(var key = 0; key < o.length; key++) {
        var values = o[key];
        var dt = document.createElement('dt');
        html_append(dt, values[0]);
        dl.appendChild(dt);
        
        var dd = document.createElement('dd');
        html_append(dd, values[1]);
        dl.appendChild(dd);
    }
    return dl;
}

function build_ins_doc_def(ins)
{
    var docdiv = document.createElement('div');
    docdiv.className = 'hover doc';
    var id = 'ins-' + ((ins && ins.name) || "noname") + '-doc';
    docdiv.id = id;

    if(ins) {
        var a = document.createElement('a');
        a.name = id;
        docdiv.appendChild(a);
        
        var p = document.createElement('span');
        p.className = 'bacaw';
        p.textContent = util.map_each_n((ins.op.toString(16).padStart(2, '0').match(/../g) || []).reverse(), function(n) {
            return n;
        }).join();
        docdiv.appendChild(p);
        
        var doc_p = document.createElement('p');
        doc_p.textContent = ins.doc;
        docdiv.appendChild(doc_p);
        var args = [];
        function push_arg_mask(mask) {
            var v = mask.shiftr;
            var k = mask.mask.toString(16);
            k = k.padStart(VM.CPU.INSTRUCTION_SIZE * 2, '0');
            args.push([i, k, ">>" + v]);
        }
        for(var i in ins.arg_masks) {
            push_arg_mask(ins.arg_masks[i]);
        }
        
        docdiv.appendChild(html_table(args));
    }
    
    return docdiv;
}

function build_ins_doc_table()
{
    var tbl = [];
    var row_headings = [];
    var col_headings = [];

    for(var col = 0; col < 16; col++) {
        var p = document.createElement('span');
        p.className = 'bacaw';
        p.textContent = col.toString(16) + "0";
        col_headings[col] = p;
    }

    for(var row = 0; row < 16; row++) {
        var p = document.createElement('span');
        p.className = 'bacaw';
        p.textContent = row.toString(16);
        row_headings[row] = p;

        tbl[row] = [];
        for(var col = 0; col < 16; col++) {
            var div = document.createElement('div');
            div.className = 'instruction';

            var ins;
            try {
                ins = VM.CPU.INS_DISPATCH.get(row);
                if(ins.constructor == DispatchTable) {
                    ins = ins.get(col << 4);
                }
            } catch(e) {
                if(e != DispatchTable.UnknownKeyError) throw(e);
                ins = null;
            }
            
            //var ins = VM.CPU.INS_INST[row | (col << 4)];
            if(ins) {
                div.onclick = function(i) { return function(ev) {
                    window.location.hash = "ins-" + i.name + "-doc";
                } }(ins);

                var ins_p = document.createElement('p');
                ins_p.className = 'name';
                ins_p.textContent = ins.name;

                if(ins.impl) {
                    ins_p.className += ' implemented';
                } else {
                    ins_p.className += ' not-implemented';
                }
                div.appendChild(ins_p);
            }
            tbl[row][col] = div;
        }
    }

    var table = html_table(tbl, row_headings, col_headings);
    return table;
}

function collect_ins(ins_list, acc)
{
    if(!acc) acc = [];
    if(!ins_list) ins_list = VM.CPU.INS_DISPATCH;

    var max = ins_list.max;
    for(var i = 0; i <= max; i++) {
        try {
            var inst = ins_list.get(ins_list.mask_op(i));
            if(inst.name) {
                acc.push([inst.name, build_ins_doc_def(inst)]);
            } else if(inst.mask) {
                collect_ins(inst, acc);
            }
        } catch(e) {
            if(e != DispatchTable.UnknownKeyError) throw(e);
        }
    }

    return acc;
}

function build_ins_list()
{
    return html_dl_arr(collect_ins(VM.CPU.INS_DISPATCH).sort(function(a, b) {
        if(a[0] < b[0]) return -1
        else if(a[0] > b[0]) return 1
        else return 0;
    }));
}

function build_ins_doc()
{
    var tbl = build_ins_doc_table();
    var list = build_ins_list();
    var div = document.createElement('div');
    div.appendChild(tbl);
    div.appendChild(list);
    return div;
}

function build_reg_doc()
{
    var div = document.createElement('div');
    var tbl = [];
    for(var i in VM.CPU.REGISTERS) {
        if(!tbl[VM.CPU.REGISTERS[i]]) {
            tbl[VM.CPU.REGISTERS[i]] = [ VM.CPU.REGISTERS[i].toString(16),
                                     i
                                   ];
        }
    }
    for(var i = 0; i < VM.CPU.REGISTER_COUNT; i++) {
        if(!tbl[i]) {
            tbl[i] = [ i.toString(16).padStart(2, '0'), "R" + i ];
        }
    }
    div.appendChild(html_table(tbl));
    return div;
}

if(typeof(module) != 'undefined') {
  module.exports = {
    build_reg_doc: build_reg_doc,
    build_ins_doc: build_ins_doc
  };
}
