// Sophia Oracle — Service Worker for true offline PWA
const CACHE_VERSION = 'sophia-v37';
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
        console.warn('SW: some precache URLs failed (icons may not exist yet):', err);
        return cache.addAll(['./', './index.html', './manifest.json']);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old SOPHIA caches only — never touch transformers-cache
// (that's where the multi-GB model files are stored by transformers.js)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('sophia-') && key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // Skip API calls (LM Studio, Ollama, etc.)
  if (url.pathname.includes('/v1/chat/completions')) return;
  if (url.pathname.includes('/api/')) return;

  // DON'T intercept HuggingFace model downloads — let transformers.js
  // manage its own cache (transformers-cache). Intercepting these causes
  // re-downloads on every SW update and wastes gigabytes of bandwidth.
  if (url.hostname.includes('huggingface.co')) return;

  // Network-first for CDN JS libraries (transformers.js runtime, etc.)
  if (url.hostname.includes('cdn.jsdelivr.net')) {
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

  // Network-first for HTML (ensures code updates are picked up immediately)
  // Cache-first for static assets (icons, manifest)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request) || caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for static assets (icons, manifest)
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
