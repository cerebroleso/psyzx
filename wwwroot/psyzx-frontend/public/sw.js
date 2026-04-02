const CACHE_NAME = 'psyzx-core-v8';
const DATA_CACHE = 'psyzx-data-v8';
const MEDIA_CACHE = 'psyzx-media-v8';

const FALLBACK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#333"/></svg>';

self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (![CACHE_NAME, DATA_CACHE, MEDIA_CACHE].includes(key)) {
                    return caches.delete(key);
                }
            })
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    const url = new URL(req.url);

    if (req.method !== 'GET') return;

    if (url.pathname.startsWith('/api/Tracks/stream')) {
        event.respondWith(handleMediaRequest(event, req));
        return;
    }

    if (url.pathname.startsWith('/api/Tracks/image')) {
        event.respondWith(handleImageRequest(req));
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        event.respondWith(handleApiRequest(req));
        return;
    }

    event.respondWith(
        caches.match(req).then(cached => cached || fetch(req).catch(() => new Response("Offline", { status: 503 })))
    );
});

async function handleApiRequest(req) {
    const cache = await caches.open(DATA_CACHE);
    try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
    } catch (err) {
        const cachedRes = await cache.match(req, { ignoreSearch: true });
        if (cachedRes) return cachedRes;
        return new Response(JSON.stringify({ error: 'offline', offlineMode: true }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function handleImageRequest(req) {
    const cache = await caches.open(DATA_CACHE);
    const url = new URL(req.url);
    url.searchParams.delete('v');
    const cacheKey = new Request(url.toString());
    
    const cachedRes = await cache.match(cacheKey);
    if (cachedRes) return cachedRes;
    
    try {
        const res = await fetch(req);
        if (res.status === 200) {
            cache.put(cacheKey, res.clone());
        }
        return res;
    } catch (err) {
        return new Response(FALLBACK_SVG, { headers: { 'Content-Type': 'image/svg+xml' } });
    }
}

async function handleMediaRequest(event, req) {
    const cache = await caches.open(MEDIA_CACHE);
    const url = new URL(req.url);
    url.searchParams.delete('v');
    const cacheKey = new Request(url.toString());

    let cachedRes = await cache.match(cacheKey);

    if (!cachedRes) {
        event.waitUntil(
            fetch(url.toString()).then(res => {
                if (res.status === 200) cache.put(cacheKey, res.clone());
            }).catch(() => {})
        );
        return fetch(req);
    }

    const rangeHeader = req.headers.get('Range');
    const blob = await cachedRes.blob();
    const total = blob.size;

    if (!rangeHeader) {
        return new Response(blob, {
            status: 200,
            headers: { 'Content-Type': cachedRes.headers.get('Content-Type') || 'audio/mpeg' }
        });
    }

    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] && parts[1] !== '' ? parseInt(parts[1], 10) : total - 1;

    if (start >= total || end >= total) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    }

    const slicedBlob = blob.slice(start, end + 1);
    return new Response(slicedBlob, {
        status: 206,
        headers: {
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': end - start + 1,
            'Content-Type': cachedRes.headers.get('Content-Type') || 'audio/mpeg',
            'Accept-Ranges': 'bytes'
        }
    });
}