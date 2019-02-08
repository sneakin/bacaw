const Subber = require('subber.js');
const vmdoc = require('vm/vm-doc.js');

function doc_init()
{
  Subber.sub(document.body);
  
    var el = document.getElementById('register-docs');
    el.replaceWith(vmdoc.build_reg_doc());
    var el = document.getElementById('instruction-docs');
    el.replaceWith(vmdoc.build_ins_doc());
}

function doc_index_onload()
{
  doc_init();
}

if(typeof(window) != 'undefined') {
  window.doc_init = doc_init;
  window.doc_index_onload = doc_index_onload;
}
