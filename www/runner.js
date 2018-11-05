const Runner = require('vm/runners/www');
const LOAD_OFFSET = 0;

function init()
{
  var vm = Runner.init(640, 480);
  if(typeof(window) != 'undefined') window.vm = vm;
  return vm;    
}

if(typeof(window) != 'undefined') {
	window.runner_init = init;
}
