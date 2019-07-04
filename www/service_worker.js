const VMWorker = require('vm/service_worker/worker');
const OldVersion = 'v1';
const Version = 'v2';
const manifest = [
  './dev.html',
  './dev.js',
  './dev_style.css',
  './style.css',
  './tabs.css',
  './xterm.css',
  './index.html',
  './index.css'
];

VMWorker.install(self, {
  cacher: {
    version: Version,
    old_version: OldVersion,
    manifest: manifest
  }
});

self.addEventListener('install', (event) => {
  console.log("Service worker installing");
});

self.addEventListener('activate', (event) => {
  console.log("Service worker activated");
});

self.addEventListener('fetch', (event) => {
  console.log("Service worker fetching", event.request);
});

self.addEventListener('message', (event) => {
  console.log("Service worker received message", event);
});
