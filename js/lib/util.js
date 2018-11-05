var REQUIRED_SCRIPTS = [];

if(false || typeof(global) == 'undefined') {
  function require(url)
  {
    // these calls get scanned and added to the HTML
    REQUIRED_SCRIPTS.push(url);
  }
}

function equals(a, b)
{
    if(typeof(a) != typeof(b)) {
        return false;
    } else if((a == null || typeof(a) != 'object')
              && (b == null || typeof(b) != 'object')) {
        return a == b;
    } else if(a instanceof Array && b instanceof Array) {
        if(a.length != b.length) {
            return false;
        }
        
        for(var i = 0; i < a.length; i++) {
            if(!equals(a[i], b[i])) return false;
        }
        
        return true;
    } else if(a[Symbol.iterator] && b[Symbol.iterator]) {
        for(var i of a) {
            if(!equals(a[i], b[i])) return false;
        }
        for(var i of b) {
            if(!equals(a[i], b[i])) return false;
        }
        return true;
    } else if(typeof(a) == 'object' && typeof(b) == 'object') {
        for(var i in a) {
            if(!equals(a[i], b[i])) return false;
        }
        for(var i in b) {
            if(!equals(a[i], b[i])) return false;
        }
        return true;
    } else {
        return (a == null && b == null);
    }
}

function to_method(f)
{
    if(typeof(f) == 'string') {
        f = function(F) { return function(v) {
            return v[F]();
        } }(f);
    }

    return f;
}

function to_kv_method(f)
{
    if(typeof(f) == 'string') {
        f = function(F) { return function(k, v) {
            return v[F]();
        } }(f);
    }

    return f;
}

function merge_options(defaults, options)
{
	var r = {};
	for(var i in defaults) {
		r[i] = defaults[i];
	}
	for(var i in options) {
		r[i] = options[i];
	}
	return r;
}

function map_each(o, f)
{
    var r = {};
    f = to_kv_method(f);
    
    for(var k in o) {
        r[k] = f(k, o[k]);
    }
    return r;
}

function map_each_n(o, f)
{
    var r = [];
    f = to_kv_method(f);
    
    for(var i = 0; i < o.length; i++) {
        r[i] = f(o[i], i);
    }
    return r;
}

function map_each_key(o, f)
{
    var r = {};
    f = to_kv_method(f);

    for(var k in o) {
        r[f(k, o[k])] = o[k];
    }
    return r;
}

function reject_if(o, f)
{
    var r = [];
    f = to_kv_method(f);

    for(var k in o) {
        if(f(o[k], k) == false) {
            r[k] = o[k];
        }
    }
    return r;
}

function reject_n_if(o, f)
{
    var r = [];
    f = to_kv_method(f);

    for(var i = 0; i < o.length; i++) {
        if(f(o[i], i) == false) {
            r.push(o[i]);
        }
    }
    return r;
}

function remove_value(arr, o)
{
    var i = arr.indexOf(o);
    return remove_n(arr, i);
}

function remove_n(arr, n)
{
    return arr.splice(0, n - 1).concat(arr.splice(n + 1));
}

function flatten(a, r)
{
	if(r == undefined) {
		r = [];
	}
	for(var i = 0; i < a.length; i++) {
		if(typeof(a[i]) == 'object') {
			flatten(a[i], r);
		} else {
			r.push(a[i]);
		}
	}
	return r;
};

function flattenDeep(arr1){
   return arr1.reduce((acc, val) => Array.isArray(val) ? acc.concat(flattenDeep(val)) : acc.concat(val), []);
}

function n_times(n, f) {
    var ret = new Array(n);
    f = to_method(f);

    for(var i = 0; i < n; i++) {
        ret[i] = f(i);
    }
    return ret;
}

function uniques(arr) {
    var tbl = {};
    for(var i in arr) {
        tbl[arr[i]] = arr[i];
    }
    var ret = [];
    for(var i in tbl) {
        ret.push(tbl[i]);
    }
    return ret;
}

if(typeof(module) != 'undefined') {
  module.exports = {
    map_each: map_each,
    map_each_n: map_each_n,
    n_times: n_times,
    equals: equals,
    merge_options: merge_options,
    flattenDeep: flattenDeep
  };
}
