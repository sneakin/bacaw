const util = require('util.js');
const vmjs = require('vm.js');
const RAM = require('vm/devices/ram.js');
const Keyboard = require('vm/devices/keyboard.js');
const Console = require('vm/devices/console.js');
const GFX = require('vm/devices/gfx.js');
const Timer = require('vm/devices/timer.js');

var vm, cpu, keyboard;
var main_window, second_window;
var image;

var program_code;
var program_labels;

function computed_style(el)
{
    return document.defaultView.getComputedStyle(el, null);
}

function js_subs(el)
{
    var w = document.createTreeWalker(el || document.body, NodeFilter.SHOW_TEXT, null, false);
    var n;
    while(n = w.nextNode()) {
        if(n.nodeType != 3) continue;
        
        var m = n.textContent.match(/\$\((.*)\)/g)
        if(m) {
            for(var i = 0; i < m.length; i++) {
                var v = m[i].slice(2, m[i].length - 1);
                n.textContent = n.textContent.replace(m[i], eval(v));
            }
        }
    }
}

function text_content(el)
{
    var w = document.createTreeWalker(el || document.body, NodeFilter.SHOW_TEXT, null, false);
    var n;
    var text = [];
    
    while(n = w.nextNode()) {
        if(n.nodeType != 3) continue;
        text.push(n.textContent);
    }

    return text;
}

function generate_dictionary()
{
    var text = text_content().join(" ").match(/\w+/g);
    //text = reject_if(text, (x) => !!x.match(/^[0-9a-fA-F]+$/));
    text = uniques(util.map_each(text, 'toLowerCase'));
    text.sort();
    return text.join("\n");
}

function bc_to_hexdump(arr)
{
    return util.flattenDeep(util.map_each_n(arr, function(c, n) {
        return c.toString(16).padStart(2, '0');
    })).join(' ');
}

function spaced_hexdump(arr)
{
    return bc_to_hexdump(program_code).match(/(...){16}/g).join('\n');
}

function pretty_hexdump(arr)
{
    return util.map_each_n(bc_to_hexdump(arr).match(/(...){16}/g),
                      (l, n) => "" + (n * 16).toString(16).padStart(8, '0') + "  " + l)
        .join('\n');
}

function init()
{
    js_subs(document.body);
}

if(typeof(module) != 'undefined') {
	module.exports = {
    init: init
	};
}

if(typeof(window) != 'undefined') {
  window.bacaw_init = bacaw_init;
}
