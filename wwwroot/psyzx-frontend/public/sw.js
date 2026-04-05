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

// --- Messaging Helpers ---
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

// --- Lifecycle ---
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

// --- Fetch Interceptor ---
self.addEventListener('fetch', event => {
    const req = event.request;
    const url = new URL(req.url);

    if (req.method !== 'GET') return;

    // 1. Navigation Fallback (Prevents White Screen)
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req).catch(() => caches.match('/index.html') || caches.match('/'))
        );
        return;
    }

    // 2. Specialized API/Media Handlers
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

    // 3. Static Assets (Stale-While-Revalidate)
    event.respondWith(
        caches.match(req).then(cached => {
            const networked = fetch(req).then(async (res) => {
                if (res.ok && url.protocol.startsWith('http')) {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(req, res.clone());
                }
                return res;
            }).catch(() => null);
            return cached || networked || new Response("Offline", { status: 404 });
        })
    );
});

// --- Handler Logic ---

async function handleApiRequest(req) {
    const cache = await caches.open(DATA_CACHE);
    const url = new URL(req.url);
    const path = url.pathname;

    // 1. ATTEMPT NETWORK FIRST
    try {
        const res = await fetch(req);
        
        // If successful and it's a GET request, update the cache
        if (res.ok && req.method === 'GET') {
            cache.put(req, res.clone());
        }
        return res;
    } catch (err) {
        // 2. NETWORK FAILED (Server is shut off)
        
        // --- A. AUTH CHECK FAKEOUT ---
        // Prevents the "White Screen" by telling the frontend we are still logged in
        if (path.endsWith('/Auth/check')) {
            return new Response(JSON.stringify({
                id: 'offline-id',
                username: 'Offline User',
                role: 'User'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // --- B. READ-ONLY DATA (GET Requests) ---
        // Serve Tracks, Playlists, Stats, and Lyrics from cache
        if (req.method === 'GET') {
            const cachedRes = await cache.match(req, { ignoreSearch: true });
            if (cachedRes) {
                console.log(`[SW] Serving Cached API: ${path}`);
                return cachedRes;
            }
        }

        // --- C. ACTIONS (POST/PUT Requests) ---
        // Scan, Login, Register, Create Playlist, YT-DLP
        // These physically require a server. We return a clean error.
        return new Response(JSON.stringify({ 
            error: 'OFFLINE_MODE', 
            message: 'Server is currently unreachable.',
            offlineMode: true 
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
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
        return caches.match('/placeholder.png') || new Response(FALLBACK_SVG, { headers: { 'Content-Type': 'image/svg+xml' } });
    }
}

async function handleMediaRequest(event, req) {
    const cache = await caches.open(MEDIA_CACHE);
    const url = new URL(req.url);
    const trackId = url.pathname.split('/').filter(Boolean).pop().split('?')[0];
    url.searchParams.delete('v');
    const cacheKey = new Request(url.toString());

    const cachedRes = await cache.match(cacheKey);
    if (cachedRes) return handleRangeLogic(cachedRes, req);

    // Force full fetch for background caching
    const fullRequest = new Request(req, { headers: new Headers(req.headers) });
    fullRequest.headers.delete('Range');

    return fetch(fullRequest).then(async (res) => {
        if (res.status !== 200) return res;

        const resClone = res.clone();
        const reader = res.body.getReader();
        const total = parseInt(res.headers.get('content-length'), 10);
        let loaded = 0, chunks = [];

        const stream = new ReadableStream({
            async start(controller) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        const fullBlob = new Blob(chunks, { type: 'audio/mpeg' });
                        const cacheRes = new Response(fullBlob, {
                            status: 200,
                            headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': fullBlob.size, 'Accept-Ranges': 'bytes' }
                        });
                        await cache.put(cacheKey, cacheRes);
                        await notifyClientsOfCacheUpdate();
                        broadcastLog(`Stored ${trackId}`);
                        controller.close();
                        break;
                    }
                    chunks.push(value);
                    loaded += value.byteLength;
                    if (total) {
                        const progress = Math.round((loaded / total) * 100);
                        if (progress % 10 === 0) broadcastProgress(trackId, progress);
                    }
                    controller.enqueue(value);
                }
            }
        });
        return handleRangeLogic(new Response(stream, { headers: resClone.headers }), req);
    });
}

async function handleRangeLogic(response, request) {
    const rangeHeader = request.headers.get('Range');
    if (!rangeHeader) return response;

    const blob = await response.blob();
    const size = blob.size;
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

    if (start >= size || end >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });

    const chunk = blob.slice(start, end + 1);
    return new Response(chunk, {
        status: 206,
        headers: {
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': end - start + 1,
            'Content-Type': 'audio/mpeg',
            'Accept-Ranges': 'bytes'
        }
    });
}