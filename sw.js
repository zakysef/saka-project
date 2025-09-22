const CACHE_CONFIG = {
  static: {
    name: 'saka-static-v3',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
  },
  dynamic: {
    name: 'saka-dynamic',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
};

// Clean old caches periodically
async function cleanCaches() {
  const cacheNames = await caches.keys();
  const validCaches = Object.values(CACHE_CONFIG).map(c => c.name);
  
  return Promise.all(
    cacheNames
      .filter(name => !validCaches.includes(name))
      .map(name => caches.delete(name))
  );
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_CONFIG.static.name).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    cleanCaches(),
    clients.claim()
  ]));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never cache cards.json
  if (event.request.url.includes('/assets/data/cards.json')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for navigation and critical app shell so updates propagate immediately
  if (url.pathname === '/' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/scripts/app.js')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          // update cache with latest
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_CONFIG.static.name).then(cache => cache.put(event.request, clone)).catch(()=>{/* ignore */});
          }
          return resp;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Default: cache-first, fallback to network, then to index.html
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request)
          .then(resp => {
            if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
            const clone = resp.clone();
            caches.open(CACHE_CONFIG.static.name).then(cache => cache.put(event.request, clone)).catch(()=>{/* ignore */});
            return resp;
          })
          .catch(() => caches.match('/index.html'));
      })
  );
});
