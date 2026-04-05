const CACHE_NAME = 'psyzx-core-v10';
const DATA_CACHE = 'psyzx-data-v10';
const MEDIA_CACHE = 'psyzx-media-v10';

const APP_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.png',
    '/placeholder.png'
];

const FALLBACK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#333"/></svg>';

const broadcastProgress = async (trackId, progress) => {
    const clients = await self.clients.matchAll();
    clients.forEach(client => client.postMessage({ type: 'DOWNLOAD_PROGRESS', trackId, progress }));
};

const broadcastLog = async (msg) => {
    const clients = await self.clients.matchAll();
    clients.forEach(client => client.postMessage({ type: 'DEBUG_LOG', msg: `[SW] ${msg}` }));
};

const notifyClientsOfCacheUpdate = async () => {
    try {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach(client => client.postMessage({ type: 'CACHE_UPDATED' }));
    } catch (err) { console.warn('[SW] Notification failed:', err); }
};

// Listen for frontend requests to preload upcoming tracks
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'PRELOAD_TRACKS') {
        const trackIds = event.data.trackIds;
        trackIds.forEach(id => {
            const url = `/api/Tracks/stream/${id}`;
            const cacheKey = new Request(new URL(url, self.location.origin).toString());
            backgroundCacheMedia(cacheKey, url, id);
        });
    }
});

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return Promise.all(APP_ASSETS.map(url => cache.add(url).catch(e => console.warn(e))));
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.map(key => {
                if (![CACHE_NAME, DATA_CACHE, MEDIA_CACHE].includes(key)) return caches.delete(key);
            })
        )).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    const url = new URL(req.url);

    if (url.pathname.startsWith('/api/Tracks/stream')) {
        if (req.method !== 'GET') return;
        event.respondWith(handleMediaRequest(event, req));
        return;
    }
    if (url.pathname.startsWith('/api/Tracks/image')) {
        if (req.method !== 'GET') return;
        event.respondWith(handleImageRequest(req));
        return;
    }
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(handleApiRequest(req));
        return;
    }

    if (req.method !== 'GET') return;

    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req).catch(async () => {
                const cachedHtml = await caches.match('/index.html');
                if (cachedHtml) return cachedHtml;

                const cachedRoot = await caches.match('/');
                if (cachedRoot) return cachedRoot;

                return new Response("Offline Mode: Application unreachable.", { 
                    status: 503, 
                    headers: { 'Content-Type': 'text/html' } 
                });
            })
        );
        return;
    }

    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req).then(async (res) => {
                if (res.ok && url.protocol.startsWith('http')) {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(req, res.clone());
                }
                return res;
            }).catch(() => {
                return new Response("Offline Mode: Resource unavailable.", { 
                    status: 503,
                    statusText: "Service Unavailable",
                    headers: new Headers({ 'Content-Type': 'text/plain' })
                });
            });
        })
    );
});

async function handleApiRequest(req) {
    const cache = await caches.open(DATA_CACHE);
    const url = new URL(req.url);
    const path = url.pathname;

    try {
        const res = await fetch(req);
        if (res.ok && req.method === 'GET') cache.put(req, res.clone());
        return res;
    } catch (err) {
        if (path.endsWith('/Auth/check')) {
            return new Response(JSON.stringify({ id: 'offline-id', username: 'Offline User', role: 'User' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (req.method === 'GET') {
            const cachedRes = await cache.match(req, { ignoreSearch: true });
            if (cachedRes) return cachedRes;
        }
        return new Response(JSON.stringify({ error: 'OFFLINE_MODE', message: 'Server is currently unreachable.', offlineMode: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
}

async function handleImageRequest(req) {
    const cache = await caches.open(DATA_CACHE);
    const url = new URL(req.url);
    url.searchParams.delete('v');
    url.searchParams.delete('token');
    const cacheKey = new Request(url.toString());

    const cachedRes = await cache.match(cacheKey);
    if (cachedRes) return cachedRes;

    try {
        const res = await fetch(req);
        if (res.status === 200) cache.put(cacheKey, res.clone());
        return res;
    } catch (err) {
        const placeholder = await caches.match('/placeholder.png');
        if (placeholder) return placeholder;
        return new Response(FALLBACK_SVG, { headers: { 'Content-Type': 'image/svg+xml' } });
    }
}

async function handleMediaRequest(event, req) {
    const cache = await caches.open(MEDIA_CACHE);
    const url = new URL(req.url);
    const trackId = url.pathname.split('/').filter(Boolean).pop().split('?')[0];
    url.searchParams.delete('v');
    const cacheKey = new Request(url.toString());

    const cachedRes = await cache.match(cacheKey);
    // 1. If we have it fully downloaded, slice it and serve it offline instantly
    if (cachedRes) return handleRangeLogic(cachedRes, req);

    // 2. If NOT cached, we trigger the background download for future/offline use
    event.waitUntil(backgroundCacheMedia(cacheKey, req.url, trackId));

    // 3. We instantly return a standard network fetch to the audio player so it 
    // bypasses the blob wait and starts playing immediately via the browser's native engine.
    return fetch(req).catch(() => new Response("Network Error", { status: 503 }));
}

// Dedicated function to silently download and cache media
async function backgroundCacheMedia(cacheKey, originalUrl, trackId) {
    const cache = await caches.open(MEDIA_CACHE);
    
    // Check if it's already cached or currently being cached to prevent duplicate requests
    if (await cache.match(cacheKey)) return;

    // Strip range headers so we get the full 200 OK file
    const fullReq = new Request(originalUrl, { headers: {} });

    try {
        const res = await fetch(fullReq);
        if (res.status !== 200) return;

        const contentType = res.headers.get('content-type') || 'audio/mpeg';
        const reader = res.body.getReader();
        const total = parseInt(res.headers.get('content-length'), 10);
        let loaded = 0, chunks = [];

        // Read stream to calculate progress, then save blob
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                const fullBlob = new Blob(chunks, { type: contentType });
                const cacheRes = new Response(fullBlob, {
                    status: 200,
                    headers: { 
                        'Content-Type': contentType, 
                        'Content-Length': fullBlob.size.toString(), 
                        'Accept-Ranges': 'bytes' 
                    }
                });
                await cache.put(cacheKey, cacheRes);
                await notifyClientsOfCacheUpdate();
                broadcastLog(`Stored ${trackId}`);
                break;
            }
            chunks.push(value);
            loaded += value.byteLength;
            if (total) {
                const progress = Math.round((loaded / total) * 100);
                if (progress % 5 === 0) broadcastProgress(trackId, progress);
            }
        }
    } catch (err) {
        console.error(`[SW] Background cache failed for ${trackId}:`, err);
    }
}

async function handleRangeLogic(response, request) {
    try {
        const blob = await response.blob();
        const size = blob.size;
        const contentType = response.headers.get('Content-Type') || 'audio/mpeg';
        const rangeHeader = request.headers.get('Range');

        if (!rangeHeader) {
            return new Response(blob, {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': size.toString(),
                    'Accept-Ranges': 'bytes'
                }
            });
        }

        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

        if (start >= size || end >= size) {
            return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        }

        const chunk = blob.slice(start, end + 1, contentType);
        
        return new Response(chunk, {
            status: 206,
            headers: {
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Content-Length': chunk.size.toString(), 
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes'
            }
        });
    } catch (e) {
        return new Response(null, { status: 500 });
    }
}