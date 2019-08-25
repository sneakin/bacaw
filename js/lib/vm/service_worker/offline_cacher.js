const moreutil = require('more_util');

function clear_old_cache(old_version, version)
{
  caches.has(old_version).then(() => {
    caches.delete(old_version).then(() => {
      console.log("Deleted old cache", old_version);
    });
  });
}

function cache_manifest(version, manifest)
{
  caches.open(version).then((cache) => {
    return cache.addAll(manifest);
  }).catch((error) => {
    console.log("Offline Cacher failed to cache", error, error.code, error.message, error.name);
  });
}

function cache_resource(request, response, options) {
  var r = response.clone();
  caches.open(options.version).then((cache) => {
    cache.put(request, r).then(() => {
      console.log("Cached", request);
    }).catch((error) => {
      console.log("Failed caching", error, error.code, error.message, error.name);
    });
  });
}

function fetch_from_cache(request, options)
{
  return caches.match(request).then((response) => {
    if(response !== undefined) {
      return response;
    } else {
      return options.error_page(404, 'Not found');
    }
  }).catch((error) => {
    return options.error_page(error.code, error.message);
  });
}

function fetch_first(event, options)
{
  // try the network, cache, or fail
  return event.respondWith(fetch(event.request).then((response) => {
    cache_resource(event.request, response, options);
    return response;
  }).catch((error) => {
    console.log("Offline Cacher error ", error);
    return fetch_from_cache(event.request, options);
  }));
}

function error_page(code, message)
{
  return new Response('Error: ' + code + ': ' + message, {
    status: code,
    statusText: message
  });
}

const Worker = {
  fetch_first: fetch_first,
  error_page: error_page
};

Worker.Defaults = {
  fetcher: Worker.fetch_first,
  error_page: Worker.error_page
};


Worker.install = function(self, options) {
  options = moreutil.merge_options(Worker.Defaults, options);

  if(options.manifest) {
    self.addEventListener('install', (event) => {
      console.log("Offline Cacher installing");
      event.waitUntil(cache_manifest(options.version, options.manifest));
    });
  }

  if(options.old_version) {
    self.addEventListener('activate', (event) => {
      console.log("Offline Cacher activated");
      clear_old_cache(options.old_version, options.version);
    });
  }

  if(options.fetcher) {
    self.addEventListener('fetch', (event) => {
      console.log("Offline Cacher fetching", event.request);
      return options.fetcher(event, options);
    });
  }
}

if(typeof(module) != 'undefined') {
  module.exports = Worker;
}
