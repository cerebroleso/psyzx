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

let downloadQueue = [];
let activeDownloads = 0;
const MAX_CONCURRENT = 5; // Increased for metadata sweep

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
    } catch (err) {}
};

const processQueue = async () => {
    if (activeDownloads >= MAX_CONCURRENT || downloadQueue.length === 0) return;

    while (activeDownloads < MAX_CONCURRENT && downloadQueue.length > 0) {
        const { type, cacheKey, url, trackId } = downloadQueue.shift();
        
        const targetCacheName = type === 'MEDIA' ? MEDIA_CACHE : DATA_CACHE;
        const cache = await caches.open(targetCacheName);
        
        const existing = await cache.match(cacheKey, { ignoreVary: true });
        if (existing) continue;

        activeDownloads++;
        
        (async () => {
            try {
                if (type === 'MEDIA') {
                    await backgroundCacheMedia(cacheKey, url, trackId);
                } else {
                    // Optimized for JSON/Images
                    const res = await fetch(new Request(url, { credentials: 'include' }));
                    if (res.ok || res.type === 'opaque') await cache.put(cacheKey, res);
                }
            } catch (e) {
                console.error(e);
            } finally {
                activeDownloads--;
                processQueue();
            }
        })();
    }
};

async function backgroundCacheMedia(cacheKey, originalUrl, trackId) {
    const cache = await caches.open(MEDIA_CACHE);
    const fullReq = new Request(originalUrl, { credentials: 'include' });
    fullReq.headers.delete('Range');

    try {
        const res = await fetch(fullReq);
        if (!res.ok) return;

        const contentType = res.headers.get('content-type') || 'audio/mpeg';
        const reader = res.body.getReader();
        const total = parseInt(res.headers.get('content-length'), 10);
        let loaded = 0, chunks = [];

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
        broadcastLog(`Failed ${trackId}`);
    }
}

self.addEventListener('message', event => {
    // 1. Existing Full Download (Audio + Meta + Image)
    if (event.data && event.data.type === 'PRELOAD_TRACKS') {
        event.data.trackIds.forEach(id => {
            const streamUrl = `/api/Tracks/stream/${id}`;
            downloadQueue.push({ type: 'MEDIA', cacheKey: new Request(new URL(streamUrl, self.location.origin).toString()), url: streamUrl, trackId: id });
            
            queueMetadata(id);
        });
        processQueue();
    }

    // 2. NEW: Metadata Only Sweep (JSON + Image + Lyrics for the whole DB)
    if (event.data && event.data.type === 'PRELOAD_METADATA') {
        event.data.trackIds.forEach(id => queueMetadata(id));
        processQueue();
    }
});

// Helper to keep the queue logic DRY
function queueMetadata(id) {
    const metaUrl = `/api/Tracks/${id}`;
    const imgUrl = `/api/Tracks/image/${id}`;
    const lyricsUrl = `/api/Tracks/lyrics/${id}`;

    downloadQueue.push({ type: 'DATA', cacheKey: new Request(new URL(metaUrl, self.location.origin).toString()), url: metaUrl, trackId: id });
    downloadQueue.push({ type: 'DATA', cacheKey: new Request(new URL(imgUrl, self.location.origin).toString()), url: imgUrl, trackId: id });
    downloadQueue.push({ type: 'DATA', cacheKey: new Request(new URL(lyricsUrl, self.location.origin).toString()), url: lyricsUrl, trackId: id });
}

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_ASSETS)));
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
                return cachedHtml || new Response("Offline", { status: 503 });
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
            }).catch(() => new Response("Offline", { status: 503 }));
        })
    );
});

async function handleApiRequest(req) {
    const cache = await caches.open(DATA_CACHE);
    const url = new URL(req.url);
    url.searchParams.delete('token');
    url.searchParams.delete('v');
    url.searchParams.delete('_'); 
    const cacheKey = new Request(url.toString());

    try {
        const res = await fetch(req);
        if (res.ok && req.method === 'GET') cache.put(cacheKey, res.clone());
        return res;
    } catch (err) {
        const cachedRes = await cache.match(cacheKey, { ignoreVary: true });
        return cachedRes || new Response(JSON.stringify({ error: 'OFFLINE' }), { 
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
    url.searchParams.delete('_');
    const cacheKey = new Request(url.toString());

    const cachedRes = await cache.match(cacheKey, { ignoreVary: true });
    if (cachedRes) return cachedRes;

    try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(cacheKey, res.clone());
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
    
    const cachedRes = await cache.match(cacheKey, { ignoreVary: true });
    if (cachedRes) return handleRangeLogic(cachedRes, req);
    
    event.waitUntil(backgroundCacheMedia(cacheKey, req.url, trackId));
    return fetch(req).catch(() => new Response(null, { status: 503 }));
}

async function handleRangeLogic(response, request) {
    try {
        const blob = await response.blob();
        const size = blob.size;
        const contentType = response.headers.get('Content-Type') || 'audio/mpeg';
        const rangeHeader = request.headers.get('Range');
        if (!rangeHeader) {
            return new Response(blob, { status: 200, headers: { 'Content-Type': contentType, 'Content-Length': size.toString(), 'Accept-Ranges': 'bytes' } });
        }
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
        const chunk = blob.slice(start, end + 1, contentType);
        return new Response(chunk, {
            status: 206,
            headers: { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': chunk.size.toString(), 'Content-Type': contentType, 'Accept-Ranges': 'bytes' }
        });
    } catch (e) {
        return new Response(null, { status: 500 });
    }
}