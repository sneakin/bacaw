const moreutil = require('more_util');
const Cacher = require('vm/service_worker/offline_cacher');

function Worker()
{
}

Worker.Defaults = {
  cacher: {
    fetcher: Cacher.fetch_first
  }
};

Worker.install = function(self, options) {
  options = moreutil.merge_options(Worker.Defaults, options);

  Cacher.install(self, options.cacher);

  self.addEventListener('install', (event) => {
    console.log("VM worker installing");
  });

  self.addEventListener('activate', (event) => {
    console.log("VM worker activated");
  });

  // messages?
}

if(typeof(module) != 'undefined') {
  module.exports = Worker;
}
