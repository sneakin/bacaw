const util = require("util.js");

function assert(a, msg)
{
	  if(typeof(a) == 'function') {
		    a = a();
	  }
	  if(!a) {
        throw(msg);
	  }
}

function assert_eq(a, b, msg)
{
	  if(typeof(a) == 'function') {
		    a = a();
	  }
	  if(typeof(b) == 'function') {
		    b = b();
	  }
    assert(a == b, msg + ": '" + a + "' == '" + b + "'");
}

function assert_equal(a, b, msg)
{
	  if(typeof(a) == 'function') {
		    a = a();
	  }
	  if(typeof(b) == 'function') {
		    b = b();
	  }
    assert(util.equals(a, b), msg + ": '" + a + "' equals '" + b + "'");
}

function assert_not_equal(a, b, msg)
{
	  if(typeof(a) == 'function') {
		    a = a();
	  }
	  if(typeof(b) == 'function') {
		    b = b();
	  }
    assert(!util.equals(a, b), msg + ": '" + a + "' not equal to '" + b + "'");
}

function assert_throws(f, err, msg)
{
    try {
        f.call(this);
        assert(false, msg);
    } catch(e) {
        if(err) {
            assert_equal(e, err, msg);
        }
    }
}

if(typeof(module) != 'undefined') {
  module.exports = {
    assert: assert,
    eq: assert_eq,
    equal: assert_equal,
    not_equal: assert_not_equal,
    is_thrown: assert_throws
  };
}
