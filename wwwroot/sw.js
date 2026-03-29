const CACHE_NAME = 'psyzx-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
    if (e.request.url.includes('/api/Tracks/stream')) return;
    
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});

self.addEventListener('message', (event) => {
    if (event.data.type === 'PRECACHE_NEXT') {
        caches.open('psyzx-v1').then((cache) => cache.add(event.data.url));
    }
});