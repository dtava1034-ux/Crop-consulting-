/* Tavares Portal — offline support.
   Pages load from the network when there's signal (so updates show up right away)
   and fall back to the copy saved on the phone when there isn't. Fonts, the map
   library and map tiles you've already viewed are kept for offline use too. */
const CORE_CACHE = 'tcc-core-v1';
const ASSET_CACHE = 'tcc-assets-v1';
const TILE_CACHE = 'tcc-tiles-v1';
const MAX_TILES = 1500;
const CORE = ['./', './index.html', './report.html', './grower.html'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CORE_CACHE).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  const keep = [CORE_CACHE, ASSET_CACHE, TILE_CACHE];
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function timeout(ms) { return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)); }

// Network first (with a time limit so a weak signal doesn't hang), then the saved copy.
async function networkFirst(request, cacheName, ms) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([fetch(request), timeout(ms)]);
    if (res && res.ok) cache.put(stripSearch(request), res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(stripSearch(request)) || await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const home = await cache.match('./index.html') || await cache.match('./');
      if (home) return home;
    }
    throw e;
  }
}
function stripSearch(request) {
  const u = new URL(request.url);
  if (u.origin !== self.location.origin) return request;
  u.search = '';
  return new Request(u.href);
}
// Saved copy first, refreshed in the background.
async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(request, res.clone());
    if (limit) trim(cache, limit);
  }
  return res;
}
async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length > limit) for (const k of keys.slice(0, keys.length - limit)) await cache.delete(k);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.github.com') return;              // publishing always goes straight to GitHub
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    if (url.pathname.includes('/g/')) {                          // grower portal data
      event.respondWith(networkFirst(req, CORE_CACHE, 8000));
      return;
    }
    event.respondWith(networkFirst(req, CORE_CACHE, 4000));
    return;
  }
  if (/arcgisonline\.com|tile\.openstreetmap\.org/.test(url.hostname)) {
    event.respondWith(cacheFirst(req, TILE_CACHE, MAX_TILES).catch(() => new Response('', { status: 504 })));
    return;
  }
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com/.test(url.hostname)) {
    event.respondWith(cacheFirst(req, ASSET_CACHE).catch(() => new Response('', { status: 504 })));
  }
});
