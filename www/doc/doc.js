const bc = require("bacaw.js");
const vmdoc = require('vm/vm-doc.js');

function doc_init()
{
    var el = document.getElementById('register-docs');
    el.replaceWith(vmdoc.build_reg_doc());
    var el = document.getElementById('instruction-docs');
    el.replaceWith(vmdoc.build_ins_doc());
}

function doc_index_onload()
{
  doc_init();
  bc.init();
}

if(typeof(window) != 'undefined') {
  window.doc_init = doc_init;
  window.doc_index_onload = doc_index_onload;
}
