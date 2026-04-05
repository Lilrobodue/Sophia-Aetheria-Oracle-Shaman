// Sophia Oracle — Service Worker for true offline PWA
const CACHE_VERSION = 'sophia-v2';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

// Install: pre-cache the shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        // Icons may not exist yet on first install — that's OK,
        // they'll be generated and cached by the page.
        console.warn('SW: some precache URLs failed (icons may not exist yet):', err);
        // At minimum cache the HTML
        return cache.addAll(['./', './index.html', './manifest.json']);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches, claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for app shell, network-first for API/CDN
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // Skip API calls (LM Studio, Ollama, etc.)
  if (url.pathname.includes('/v1/chat/completions')) return;
  if (url.pathname.includes('/api/')) return;

  // Network-first for CDN resources (transformers.js, etc.) — always try fresh
  if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('huggingface.co')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for local app files (HTML, icons, manifest)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback — serve the main page for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Handle messages from the page (e.g., cache generated icons)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_ICON') {
    const { url, blob } = event.data;
    caches.open(CACHE_VERSION).then((cache) => {
      cache.put(url, new Response(blob, {
        headers: { 'Content-Type': 'image/png' }
      }));
    });
  }
});
