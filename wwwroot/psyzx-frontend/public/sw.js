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
const MAX_CONCURRENT = 3; 

function getCleanApiRequest(urlStr) {
    const url = new URL(urlStr, self.location.origin);
    url.searchParams.delete('v');
    url.searchParams.delete('token');
    url.searchParams.delete('_');
    return url.toString(); 
}

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
        
        const existing = await cache.match(cacheKey); 
        if (existing) continue;

        activeDownloads++;
        
        (async () => {
            try {
                if (type === 'MEDIA') {
                    await backgroundCacheMedia(cacheKey, url, trackId);
                } else {
                    const res = await fetch(new Request(url, { credentials: 'include' }));
                    if (res.ok) await cache.put(cacheKey, res); 
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

    try {
        const res = await fetch(fullReq);
        if (!res.ok) return;

        const cachePromise = cache.put(cacheKey, res.clone());
        
        const total = parseInt(res.headers.get('content-length'), 10);
        if (!total) {
            await cachePromise;
            await notifyClientsOfCacheUpdate();
            broadcastLog(`Stored ${trackId}`);
            return;
        }

        const reader = res.body.getReader();
        let loaded = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                await cachePromise; 
                await notifyClientsOfCacheUpdate();
                broadcastLog(`Stored ${trackId}`);
                break;
            }
            loaded += value.byteLength;
            const progress = Math.round((loaded / total) * 100);
            if (progress % 5 === 0) broadcastProgress(trackId, progress);
        }
    } catch (err) {
        broadcastLog(`Failed ${trackId}`);
    }
}

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'PRELOAD_TRACKS') {
        if (event.data.coverPath) {
            const coverUrl = `/api/Tracks/image?path=${encodeURIComponent(event.data.coverPath)}`;
            downloadQueue.push({ type: 'DATA', cacheKey: getCleanApiRequest(coverUrl), url: coverUrl, trackId: 'cover' });
        }

        event.data.trackIds.forEach(id => {
            const streamUrl = `/api/Tracks/stream/${id}`;
            downloadQueue.push({ type: 'MEDIA', cacheKey: getCleanApiRequest(streamUrl), url: streamUrl, trackId: id });
            queueMetadata(id);
        });
        processQueue();
    }

    if (event.data && event.data.type === 'PRELOAD_METADATA') {
        event.data.trackIds.forEach(id => queueMetadata(id));
        processQueue();
    }
});

function queueMetadata(id) {
    const lyricsUrl = `/api/Tracks/lyrics/${id}`;
    downloadQueue.push({ type: 'DATA', cacheKey: getCleanApiRequest(lyricsUrl), url: lyricsUrl, trackId: id });
}

// 🔥 FIX 1: Fault-Tolerant iOS Installation
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            for (let asset of APP_ASSETS) {
                try {
                    const res = await fetch(asset);
                    if (res.ok) await cache.put(asset, res);
                } catch (err) {
                    console.warn(`[SW] Ignored missing asset during install: ${asset}`);
                }
            }
        })
    );
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

    if (
        url.pathname.startsWith('/@') ||            
        url.pathname.startsWith('/src/') ||          
        url.pathname.startsWith('/node_modules/') || 
        url.searchParams.has('import') ||            
        url.searchParams.has('t')                    
    ) {
        return; 
    }

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

    if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
        event.respondWith(handleHtmlRequest(req));
        return;
    }

    if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
        event.respondWith(handleAppAsset(req));
        return;
    }

    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req).then(async (res) => {
                if (!res.ok) throw new Error('Network fallback failed');
                if (url.protocol.startsWith('http')) {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(req.url, res.clone()); 
                }
                return res;
            }).catch(() => new Response("Offline", { status: 503 }));
        })
    );
});

// --- CORE HANDLERS ---

async function handleHtmlRequest(req) {
    const cache = await caches.open(CACHE_NAME);
    const origin = self.location.origin;

    try {
        // 🔥 FIX 2: iOS 'navigate' fetch crash prevention. 
        // We fetch the raw URL string instead of the Request object.
        const res = await fetch(req.url);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        
        await cache.put(origin + '/', res.clone());
        await cache.put(origin + '/index.html', res.clone());
        
        return res;
    } catch (err) {
        const cachedHtml = (await cache.match(origin + '/')) 
            || (await cache.match(origin + '/index.html'))
            || (await cache.match('/'));
            
        return cachedHtml || new Response("<h2 style='text-align:center;font-family:sans-serif;margin-top:20vh;'>App Offline</h2>", { status: 503, headers: { 'Content-Type': 'text/html' } });
    }
}

async function handleAppAsset(req) {
    const cache = await caches.open(CACHE_NAME);
    const reqUrl = new URL(req.url);
    const cleanUrlStr = reqUrl.origin + reqUrl.pathname; 
    
    // 1. Cache First
    let cached = await cache.match(cleanUrlStr);
    if (!cached) cached = await cache.match(req.url); // iOS Safe: URL string
    if (cached) return cached;

    // 2. Network Fallback
    try {
        // 🔥 iOS BUG FIX: Fetch the string URL, not the strict Request object.
        // iOS Safari sometimes blocks intercepted module script requests.
        const fetchRes = await fetch(req.url);
        if (!fetchRes.ok) throw new Error(`Asset fetch failed: ${fetchRes.status}`);
        
        cache.put(cleanUrlStr, fetchRes.clone()); 
        return fetchRes;
    } catch (err) {
        // 3. Fuzzy Matcher (In case of an update while offline)
        if (reqUrl.pathname.startsWith('/assets/')) {
            const keys = await cache.keys();
            const match = reqUrl.pathname.match(/\/assets\/([^/]+)-[a-zA-Z0-9_-]+\.(js|css)$/);
            
            if (match) {
                const baseName = match[1];
                const ext = match[2];
                const fuzzyReq = keys.find(k => {
                    const kUrl = new URL(k.url);
                    return kUrl.pathname.startsWith(`/assets/${baseName}-`) && kUrl.pathname.endsWith(`.${ext}`);
                });
                // iOS Safe: Match the URL string of the found key
                if (fuzzyReq) return await cache.match(fuzzyReq.url);
            }
        }
        
        // 4. Visual Offline Fallback
        const ext = reqUrl.pathname.split('.').pop();
        if (ext === 'js') {
            const visualErrorJS = `
                window.onload = function() { 
                    document.body.innerHTML = "<div style='padding:20px; text-align:center; font-family:sans-serif; margin-top:20vh;'><h2>App Offline</h2><p>Cannot load required assets. Please reconnect to the server once to sync.</p></div>"; 
                };
                console.error("App Offline: JavaScript module unavailable.");
            `;
            return new Response(visualErrorJS, { status: 200, headers: { 'Content-Type': 'application/javascript' } });
        } else if (ext === 'css') {
            return new Response('/* Offline */', { status: 200, headers: { 'Content-Type': 'text/css' } });
        }

        return new Response(null, { status: 503 });
    }
}

async function handleApiRequest(req) {
    const cache = await caches.open(DATA_CACHE);
    const cacheKey = getCleanApiRequest(req.url);

    try {
        const res = await fetch(req);
        if (req.method === 'GET' && res.status >= 500) throw new Error('Proxy Offline');
        
        if (res.ok && req.method === 'GET') cache.put(cacheKey, res.clone());
        return res;
    } catch (err) {
        if (req.method !== 'GET') {
            return new Response(JSON.stringify({ ok: false, error: 'ACTION_UNAVAILABLE_OFFLINE' }), { 
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        const cachedRes = await cache.match(cacheKey);
        return cachedRes || new Response(JSON.stringify({ error: 'OFFLINE' }), { 
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function handleImageRequest(req) {
    const cache = await caches.open(DATA_CACHE);
    const cacheKey = getCleanApiRequest(req.url);

    const cachedRes = await cache.match(cacheKey);
    if (cachedRes) return cachedRes;

    try {
        const res = await fetch(req);
        if (req.method === 'GET' && res.status >= 500) throw new Error('Proxy Offline');
        if (res.ok || res.type === 'opaque') {
            cache.put(cacheKey, res.clone());
            return res;
        }
        throw new Error("Bad Image Response");
    } catch (err) {
        return caches.match('/placeholder.png') || new Response(FALLBACK_SVG, { headers: { 'Content-Type': 'image/svg+xml' } });
    }
}

async function handleMediaRequest(event, req) {
    const cache = await caches.open(MEDIA_CACHE);
    const cacheKey = getCleanApiRequest(req.url);
    const url = new URL(req.url);
    const trackId = url.pathname.split('/').filter(Boolean).pop().split('?')[0];
    
    const cachedRes = await cache.match(cacheKey);
    if (cachedRes) return handleRangeLogic(cachedRes, req);
    
    if (activeDownloads < MAX_CONCURRENT && navigator.onLine) {
        event.waitUntil(backgroundCacheMedia(cacheKey, req.url, trackId));
    }
    
    return fetch(req).catch(() => Response.error());
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
                    'Accept-Ranges': 'bytes',
                    'Access-Control-Allow-Origin': '*' 
                } 
            });
        }
        
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
        const chunk = blob.slice(start, end + 1, contentType);
        
        return new Response(chunk, {
            status: 206,
            headers: { 
                'Content-Range': `bytes ${start}-${end}/${size}`, 
                'Content-Length': chunk.size.toString(), 
                'Content-Type': contentType, 
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*' 
            }
        });
    } catch (e) {
        return new Response(null, { status: 500 });
    }
}