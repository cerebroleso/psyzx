const CACHE_NAME = 'psyzx-core-v10';
const DATA_CACHE = 'psyzx-data-v10';
const MEDIA_CACHE = 'psyzx-media-v10';

// ── MANIFEST CONFIG (Added) ──
const META_KEY = 'psyzx:media-manifest';
let cacheLimit = 200 * 1024 * 1024;   // 200 MB default
let noDownload = false;               // when true, skip all background caching
let mediaManifest = null;

const APP_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json'
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
        const res = await cache.match(META_KEY, { ignoreVary: true });
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
    } catch { }
}

async function enforceLimit() {
    const manifest = await loadManifest();
    let totalSize = Object.values(manifest).reduce((s, v) => s + (v.size || 0), 0);
    if (totalSize <= cacheLimit) return false;

    const sorted = Object.entries(manifest).sort(([, a], [, b]) => a.timestamp - b.timestamp);
    const mediaCache = await caches.open(MEDIA_CACHE);
    let evicted = false;

    for (const [trackId, meta] of sorted) {
        if (totalSize <= cacheLimit) break;
        try {
            await mediaCache.delete(meta.cacheKey);
        } catch { }
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
    const manifest = await loadManifest();
    const mediaCache = await caches.open(MEDIA_CACHE);

    if (manifest[trackId]) {
        try { await mediaCache.delete(manifest[trackId].cacheKey); } catch { }
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
    } catch { }

    await notifyClientsOfCacheUpdate();
}

// ── UTILS ──
function getCleanApiRequest(urlStr) {
    const url = new URL(urlStr, self.location.origin);
    // Keep 'v' parameter for cache busting.
    url.searchParams.delete('token');
    url.searchParams.delete('_');
    url.searchParams.delete('kbps');
    url.searchParams.delete('format');
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
    } catch (err) { }
};

// ── Helper: fetch with timeout (prevents iOS Safari hangs) ──
function fetchWithTimeout(request, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Fetch timeout'));
        }, timeoutMs);

        const fetchOpts = { signal: controller.signal };
        // Preserve credentials from original request if it's a Request object
        if (request instanceof Request) {
            fetchOpts.credentials = request.credentials || 'same-origin';
        }

        fetch(request, fetchOpts)
            .then(res => { clearTimeout(timer); resolve(res); })
            .catch(err => { clearTimeout(timer); reject(err); });
    });
}

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
        headers.set('Content-Length', arrayBuffer.byteLength.toString());
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Type', res.headers.get('Content-Type') || 'audio/mpeg');
        // Strip Vary header to prevent iOS cache-match misses
        headers.delete('Vary');

        const cachedResponse = new Response(arrayBuffer.slice(0), {
            status: 200,
            statusText: 'OK',
            headers
        });

        await cache.put(cacheKey, cachedResponse);

        // Update manifest with size
        const manifest = await loadManifest();
        manifest[trackId] = {
            size: arrayBuffer.byteLength,
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
        const manifest = await loadManifest();
        const totalSize = Object.values(manifest).reduce((s, v) => s + (v.size || 0), 0);
        const clients = await self.clients.matchAll();
        clients.forEach(c => c.postMessage({ type: 'CACHE_STATS', totalSize, trackCount: Object.keys(manifest).length }));
    }
});

function queueMetadata(id) {
    // const lyricsUrl = `/api/Tracks/lyrics/${id}`;
    // downloadQueue.push({ type: 'DATA', cacheKey: getCleanApiRequest(lyricsUrl), url: lyricsUrl, trackId: id });
}

// ── LIFECYCLE ──
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            // Pre-cache known static assets (non-hashed)
            for (let asset of APP_ASSETS) {
                try {
                    const res = await fetch(asset, { cache: 'no-cache' });
                    if (res.ok) await cache.put(asset, res);
                } catch (err) {
                    console.warn(`[SW] Ignored missing asset during install: ${asset}`);
                }
            }

            // Also cache the navigation response as index.html
            // This ensures the SPA shell is always available
            try {
                const htmlRes = await fetch('/', { cache: 'no-cache' });
                if (htmlRes.ok) {
                    await cache.put('/', htmlRes.clone());
                    await cache.put('/index.html', htmlRes.clone());
                }
            } catch { }
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

    // Skip Vite dev server requests
    if (
        url.pathname.startsWith('/@') ||
        url.pathname.startsWith('/src/') ||
        url.pathname.startsWith('/node_modules/') ||
        url.searchParams.has('import') ||
        url.searchParams.has('t')
    ) {
        return;
    }

    // ── MEDIA STREAMS ──
    if (url.pathname.startsWith('/api/Tracks/stream')) {
        // MSE fragmented MP4 streams bypass SW entirely (they use MediaSource API)
        if (url.searchParams.get('format') === 'mp4') {
            return;
        }
        // Standard MP3/audio stream requests — serve from cache if available,
        // ALWAYS fall back to network. Never block playback.
        if (req.method !== 'GET') return;
        event.respondWith(handleMediaRequest(event, req));
        return;
    }

    // ── IMAGES ──
    if (url.pathname.startsWith('/api/Tracks/image')) {
        if (req.method !== 'GET') return;
        event.respondWith(handleImageRequest(req));
        return;
    }

    // ── OTHER LOCAL API ──
    if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
        event.respondWith(handleApiRequest(req));
        return;
    }

    if (req.method !== 'GET') return;

    // ── HTML / NAVIGATION ──
    if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
        event.respondWith(handleHtmlRequest(req));
        return;
    }

    // ── APP ASSETS (JS, CSS, fonts, etc.) ──
    if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
        event.respondWith(handleAppAsset(req));
        return;
    }

    // ── EVERYTHING ELSE (Third-party, fonts, etc.) ──
    if (url.origin !== self.location.origin) {
        return; // Let browser handle cross-origin requests normally
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
        const res = await fetchWithTimeout(req.url, 6000);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);

        // Cache the fresh HTML under multiple keys for robustness
        await cache.put(origin + '/', res.clone());
        await cache.put(origin + '/index.html', res.clone());

        return res;
    } catch (err) {
        // Offline: serve from cache with multiple fallback keys
        const cachedHtml = (await cache.match(origin + '/', { ignoreVary: true }))
            || (await cache.match(origin + '/index.html', { ignoreVary: true }))
            || (await cache.match('/', { ignoreVary: true }))
            || (await cache.match('/index.html', { ignoreVary: true }));

        return cachedHtml || new Response(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>psyzx</title><style>body{background:#121212;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}h2{font-size:18px;font-weight:600;margin-bottom:8px}p{color:rgba(255,255,255,0.5);font-size:14px}</style></head><body><div><h2>Offline</h2><p>Connect to the server once to cache the app.</p></div></body></html>`,
            { status: 503, headers: { 'Content-Type': 'text/html' } }
        );
    }
}

async function handleAppAsset(req) {
    const cache = await caches.open(CACHE_NAME);
    const reqUrl = new URL(req.url);
    const cleanUrlStr = reqUrl.origin + reqUrl.pathname;

    // 1. Cache First — try exact match, then without query params
    let cached = await cache.match(cleanUrlStr, { ignoreVary: true });
    if (!cached) cached = await cache.match(req.url, { ignoreVary: true });
    if (cached) return cached;

    // 2. Network with timeout — prevents iOS Safari from hanging indefinitely
    try {
        const fetchRes = await fetchWithTimeout(req.url, 6000);
        if (!fetchRes.ok) throw new Error(`Asset fetch failed: ${fetchRes.status}`);

        // Cache with clean URL (no query params) for reliable matching
        cache.put(cleanUrlStr, fetchRes.clone());
        return fetchRes;
    } catch (err) {
        // 3. Fuzzy Matcher — handles Vite hash changes between deploys
        //    e.g. /assets/index-ABC123.js → /assets/index-DEF456.js
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

        // 4. Graceful offline fallbacks — don't break the app
        const ext = reqUrl.pathname.split('.').pop();
        if (ext === 'js') {
            return new Response(
                `console.warn("[SW] Offline: Could not load ${reqUrl.pathname}");`,
                { status: 200, headers: { 'Content-Type': 'application/javascript' } }
            );
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

// ── MEDIA REQUEST HANDLER ──
// CRITICAL: This handler MUST never block playback.
// Strategy: Try cache first → if cache hit, serve with range support.
//           If ANYTHING fails (cache miss, read error, range error), 
//           fall through to network immediately.
//           Background-cache the network response for next time.
async function handleMediaRequest(event, req) {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const lastPart = pathParts.pop();
    const trackId = lastPart ? lastPart.split('?')[0] : 'unknown';

    try {
        const cache = await caches.open(MEDIA_CACHE);
        const cacheKey = getCleanApiRequest(req.url);

        // Try cache first with ignoreVary (iOS Safari sends different Vary headers)
        const cachedRes = await cache.match(cacheKey, { ignoreVary: true });

        if (cachedRes) {
            // We have a cached response — try to serve it with range support.
            // If this fails for ANY reason, we fall through to network below.
            try {
                const rangeResponse = await handleRangeLogic(cachedRes, req);
                if (rangeResponse && rangeResponse.status !== 500) {
                    return rangeResponse;
                }
            } catch (rangeErr) {
                console.warn('[SW] Cache range serving failed, falling to network:', rangeErr.message);
                // Fall through to network
            }
        }
    } catch (cacheErr) {
        console.warn('[SW] Cache lookup error:', cacheErr.message);
        // Fall through to network
    }

    // ── NETWORK FALLBACK (always) ──
    // Fetch from the origin server. This ensures playback is never blocked.
    try {
        const networkReq = new Request(req.url, { credentials: 'include' });
        const networkRes = await fetch(networkReq);

        // Background-cache this response for offline use (don't await — non-blocking)
        if (networkRes.ok && !noDownload) {
            const cacheKey = getCleanApiRequest(req.url);
            event.waitUntil(
                backgroundCacheFromResponse(cacheKey, networkRes.clone(), trackId)
            );
        }

        return networkRes;
    } catch (networkErr) {
        // Both cache and network failed — we're truly offline with no cache
        return new Response(null, {
            status: 503,
            statusText: 'Offline - Track not cached'
        });
    }
}

// Background-cache a network response that we just served to the user.
// This runs after the response is already returned, so it never blocks playback.
async function backgroundCacheFromResponse(cacheKey, response, trackId) {
    try {
        const cache = await caches.open(MEDIA_CACHE);

        // Check if already cached (avoid duplicate work)
        const existing = await cache.match(cacheKey, { ignoreVary: true });
        if (existing) return;

        const arrayBuffer = await response.arrayBuffer();
        if (!arrayBuffer || arrayBuffer.byteLength === 0) return;

        const headers = new Headers(response.headers);
        headers.set('Content-Length', arrayBuffer.byteLength.toString());
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Type', response.headers.get('Content-Type') || 'audio/mpeg');
        headers.delete('Vary');

        const cachedResponse = new Response(arrayBuffer.slice(0), {
            status: 200,
            statusText: 'OK',
            headers
        });

        await cache.put(cacheKey, cachedResponse);

        // Update manifest with size
        const manifest = await loadManifest();
        manifest[trackId] = {
            size: arrayBuffer.byteLength,
            timestamp: Date.now(),
            cacheKey
        };
        await saveManifest();
        await enforceLimit();
        await notifyClientsOfCacheUpdate();
    } catch (err) {
        // Non-fatal — user is already hearing the track
    }
}

// ── RANGE REQUEST HANDLER ──
// Serves cached audio with proper HTTP Range support.
// iOS Safari's <audio> element requires range requests to function.
async function handleRangeLogic(response, request) {
    // Clone before reading to avoid consuming the cached response
    const buffer = await response.clone().arrayBuffer();

    if (!buffer || buffer.byteLength === 0) {
        return new Response(null, { status: 500 });
    }

    const size = buffer.byteLength;
    const contentType = response.headers.get('Content-Type') || 'audio/mpeg';
    const rangeHeader = request.headers.get('Range');

    if (!rangeHeader) {
        // No Range header — return full response
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

    // Parse Range header (e.g. "bytes=0-" or "bytes=1024-2048")
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10) || 0;
    const end = parts[1] ? Math.min(parseInt(parts[1], 10), size - 1) : size - 1;

    // Validate range
    if (start >= size || start < 0 || end < start) {
        return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` }
        });
    }

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
}