// Only the public app shell is cached. User data, API traffic and audio are excluded.
const VERSION = '__MYSUNO_VERSION__';
const PREFIX = 'mysuno-shell-' + new URL(self.registration.scope).pathname + '-';
const CACHE = PREFIX + VERSION;
const SHELL = /* __MYSUNO_SHELL__ */ [];
const URLS = new Set(SHELL.map(file => new URL(file, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // This explicit list excludes /api, model catalogs, credentials, generated audio and uploads.
  const cacheURL = request.mode === 'navigate' ? new URL('index.html', self.registration.scope).href : url.href;
  if (!URLS.has(cacheURL)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(cacheURL)) || fetch(request)));
});
