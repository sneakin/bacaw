
function Worker()
{
}

function dirname(path)
{
  var parts = path.split('/');
  return parts.slice(0, parts.length - 1).join('/');
}

function pathjoin(base, name)
{
  return base + '/' + name;
}

Worker.register = function(script, location)
{
  var root = dirname(location.pathname);
  
  return navigator.serviceWorker.register(pathjoin(root, script), {
    scope: root + "/"
  }).then((reg) => {
    console.log("Worker registered");
    this.registration = reg;
  }).catch((error) => {
    console.log("Worker register error", error);
    this.error = error;
    this.registration = null;
  });
}

if(typeof(module) != 'undefined') {
  module.exports = Worker;
}