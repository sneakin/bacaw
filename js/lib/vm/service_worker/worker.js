function Worker()
{
}

Worker.install = function(self) {
  self.addEventListener('install', (event) => {
    console.log("VM worker installing");
  });

  self.addEventListener('activate', (event) => {
    console.log("VM worker activated");
  });

  // messages
}

if(typeof(module) != 'undefined') {
  module.exports = Worker;
}
