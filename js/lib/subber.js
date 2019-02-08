function subber(el)
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

if(typeof(module) != 'undefined') {
	module.exports = {
    sub: subber
	};
}

if(typeof(window) != 'undefined') {
  window.subber = subber
}
