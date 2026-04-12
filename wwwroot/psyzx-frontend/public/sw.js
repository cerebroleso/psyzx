const CACHE_NAME = 'psyzx-core-v10';
const DATA_CACHE = 'psyzx-data-v10';
const MEDIA_CACHE = 'psyzx-media-v10';

// ── MANIFEST CONFIG (Added) ──
const META_KEY = 'psyzx:media-manifest';
let cacheLimit = 200 * 1024 * 1024;   // 200 MB default
let noDownload  = false;               // when true, skip all background caching
let mediaManifest = null;

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

// ── MANIFEST HELPERS (Added) ──
async function loadManifest() {
    if (mediaManifest !== null) return mediaManifest;
    try {
        const cache = await caches.open(DATA_CACHE);
        const res   = await cache.match(META_KEY, { ignoreVary: true });
        mediaManifest = res ? await res.json() : {};
    } catch {
        mediaManifest = {};
    }
    return mediaManifest;
}

async function saveManifest() {
    try {
        const cache = await caches.open(DATA_CACHE);
        await cache.put(
            META_KEY,
            new Response(JSON.stringify(mediaManifest), {
                headers: { 'Content-Type': 'application/json' }
            })
        );
    } catch {}
}

async function enforceLimit() {
    const manifest   = await loadManifest();
    let totalSize    = Object.values(manifest).reduce((s, v) => s + (v.size || 0), 0);
    if (totalSize <= cacheLimit) return false; 

    const sorted     = Object.entries(manifest).sort(([, a], [, b]) => a.timestamp - b.timestamp);
    const mediaCache = await caches.open(MEDIA_CACHE);
    let evicted      = false;

    for (const [trackId, meta] of sorted) {
        if (totalSize <= cacheLimit) break;
        try {
            await mediaCache.delete(meta.cacheKey);
        } catch {}
        totalSize -= (meta.size || 0);
        delete manifest[trackId];
        broadcastLog(`Evicted track ${trackId} (size limit)`);
        evicted = true;
    }

    if (evicted) {
        await saveManifest();
        await notifyClientsOfCacheUpdate();
    }
    return evicted;
}

async function deleteTrackFromCache(trackId) {
    const manifest   = await loadManifest();
    const mediaCache = await caches.open(MEDIA_CACHE);

    if (manifest[trackId]) {
        try { await mediaCache.delete(manifest[trackId].cacheKey); } catch {}
        delete manifest[trackId];
        await saveManifest();
    }

    try {
        const keys = await mediaCache.keys();
        for (const req of keys) {
            if (req.url.includes(`/Tracks/stream/${trackId}`)) {
                await mediaCache.delete(req);
            }
        }
    } catch {}

    await notifyClientsOfCacheUpdate();
}

// ── UTILS ──
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

// ── QUEUE & DOWNLOADS ──
const processQueue = async () => {
    if (activeDownloads >= MAX_CONCURRENT || downloadQueue.length === 0) return;

    while (activeDownloads < MAX_CONCURRENT && downloadQueue.length > 0) {
        const { type, cacheKey, url, trackId } = downloadQueue.shift();
        
        // Respect no-download setting
        if (noDownload && type === 'MEDIA') continue;

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
        broadcastProgress(trackId, 5);
        const res = await fetch(fullReq);
        if (!res.ok) return;

        broadcastProgress(trackId, 30);

        // Buffer the entire response body to track size and avoid iOS stream drops
        const arrayBuffer = await res.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            broadcastLog(`Empty response for ${trackId} — skipping`);
            return;
        }

        broadcastProgress(trackId, 80);

        const headers = new Headers(res.headers);
        headers.set('Content-Length',  arrayBuffer.byteLength.toString());
        headers.set('Accept-Ranges',   'bytes');
        headers.set('Content-Type',    res.headers.get('Content-Type') || 'audio/mpeg');

        const cachedResponse = new Response(arrayBuffer.slice(0), {
            status: 200,
            statusText: 'OK',
            headers
        });

        await cache.put(cacheKey, cachedResponse);

        // Update manifest with size
        const manifest = await loadManifest();
        manifest[trackId] = {
            size:      arrayBuffer.byteLength,
            timestamp: Date.now(),
            cacheKey
        };
        await saveManifest();

        broadcastProgress(trackId, 100);
        broadcastLog(`Stored ${trackId}`);

        // Evict oldest if over limit
        await enforceLimit();
        await notifyClientsOfCacheUpdate();

    } catch (err) {
        broadcastLog(`Failed ${trackId}`);
    }
}

// ── MESSAGE HANDLER ──
self.addEventListener('message', async event => {
    if (!event.data) return;
    const data = event.data;

    if (data.type === 'PRELOAD_TRACKS') {
        if (!noDownload) {
            if (data.coverPath) {
                const coverUrl = `/api/Tracks/image?path=${encodeURIComponent(data.coverPath)}`;
                downloadQueue.push({ type: 'DATA', cacheKey: getCleanApiRequest(coverUrl), url: coverUrl, trackId: 'cover' });
            }

            data.trackIds.forEach(id => {
                const streamUrl = `/api/Tracks/stream/${id}`;
                downloadQueue.push({ type: 'MEDIA', cacheKey: getCleanApiRequest(streamUrl), url: streamUrl, trackId: id });
                queueMetadata(id);
            });
            processQueue();
        }
    }

    if (data.type === 'PRELOAD_METADATA') {
        data.trackIds.forEach(id => queueMetadata(id));
        processQueue();
    }

    // ── NEW CACHE MANAGEMENT METHODS ──
    if (data.type === 'SET_CACHE_LIMIT') {
        cacheLimit = data.bytes;
        broadcastLog(`Cache limit set to ${(cacheLimit / 1024 / 1024).toFixed(0)} MB`);
        await enforceLimit();
    }

    if (data.type === 'SET_NO_DOWNLOAD') {
        noDownload = data.value;
        broadcastLog(`No-download mode: ${noDownload}`);
    }

    if (data.type === 'DELETE_TRACK') {
        await deleteTrackFromCache(data.trackId);
    }

    if (data.type === 'GET_CACHE_STATS') {
        const manifest  = await loadManifest();
        const totalSize = Object.values(manifest).reduce((s, v) => s + (v.size || 0), 0);
        const clients   = await self.clients.matchAll();
        clients.forEach(c => c.postMessage({ type: 'CACHE_STATS', totalSize, trackCount: Object.keys(manifest).length }));
    }
});

function queueMetadata(id) {
    const lyricsUrl = `/api/Tracks/lyrics/${id}`;
    downloadQueue.push({ type: 'DATA', cacheKey: getCleanApiRequest(lyricsUrl), url: lyricsUrl, trackId: id });
}

// ── LIFECYCLE ──
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

// ── FETCH ROUTER ──
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

// ── CORE HANDLERS ──

async function handleHtmlRequest(req) {
    const cache = await caches.open(CACHE_NAME);
    const origin = self.location.origin;

    try {
        const res = await fetch(req.url);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        
        await cache.put(origin + '/', res.clone());
        await cache.put(origin + '/index.html', res.clone());
        
        return res;
    } catch (err) {
        const cachedHtml = (await cache.match(origin + '/', { ignoreVary: true })) 
            || (await cache.match(origin + '/index.html', { ignoreVary: true }))
            || (await cache.match('/', { ignoreVary: true }));
            
        return cachedHtml || new Response("<h2 style='text-align:center;font-family:sans-serif;margin-top:20vh;'>App Offline</h2>", { status: 503, headers: { 'Content-Type': 'text/html' } });
    }
}

async function handleAppAsset(req) {
    const cache = await caches.open(CACHE_NAME);
    const reqUrl = new URL(req.url);
    const cleanUrlStr = reqUrl.origin + reqUrl.pathname; 
    
    // 1. Cache First
    let cached = await cache.match(cleanUrlStr, { ignoreVary: true });
    if (!cached) cached = await cache.match(req.url, { ignoreVary: true });
    if (cached) return cached;

    // 2. Network Fallback
    try {
        const fetchRes = await fetch(req.url);
        if (!fetchRes.ok) throw new Error(`Asset fetch failed: ${fetchRes.status}`);
        
        cache.put(cleanUrlStr, fetchRes.clone()); 
        return fetchRes;
    } catch (err) {
        // 3. Fuzzy Matcher
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
        
        const cachedRes = await cache.match(cacheKey, { ignoreVary: true });
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
    
    // 🔥 FIX 3: Ignore Vary headers.
    const cachedRes = await cache.match(cacheKey, { ignoreVary: true });
    if (cachedRes) return handleRangeLogic(cachedRes, req);
    
    // Respect the noDownload setting & check the manifest so we don't duplicate
    if (!noDownload && activeDownloads < MAX_CONCURRENT && navigator.onLine !== false) {
        const manifestEntry = (await loadManifest())[trackId];
        if (!manifestEntry) {
            const alreadyQueued = downloadQueue.some(q => q.trackId === String(trackId));
            if (!alreadyQueued) {
                event.waitUntil(backgroundCacheMedia(cacheKey, req.url, trackId));
            }
        }
    }
    
    return fetch(req).catch(() => Response.error());
}

async function handleRangeLogic(response, request) {
    try {
        // 🔥 FIX 4: Bypass iOS Safari's corrupt Blob slice bug
        const buffer = await response.arrayBuffer();
        
        if (!buffer || buffer.byteLength === 0) {
            return new Response(null, { status: 500 });
        }
        
        const size = buffer.byteLength;
        const contentType = response.headers.get('Content-Type') || 'audio/mpeg';
        const rangeHeader = request.headers.get('Range');
        
        if (!rangeHeader) {
            return new Response(buffer, { 
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
        
        const chunk = buffer.slice(start, end + 1);
        
        return new Response(chunk, {
            status: 206,
            headers: { 
                'Content-Range': `bytes ${start}-${end}/${size}`, 
                'Content-Length': chunk.byteLength.toString(), 
                'Content-Type': contentType, 
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*' 
            }
        });
    } catch (e) {
        console.error('[SW] Range Logic Error:', e);
        return new Response(null, { status: 500 });
    }
}