import { currentUser } from '../store.js';
import { initSync, stopSync, broadcastState } from './sync.js';
import { activePlayer } from './audio.js';
import { get } from 'svelte/store';
import { isPlaying, playerCurrentTime } from '../store.js';

const triggerMetadataSweep = (tracks) => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const trackIds = tracks.map(t => t.id);
        navigator.serviceWorker.controller.postMessage({
            type: 'PRELOAD_METADATA',
            trackIds
        });
    }
};

const LYRICS_CACHE_KEY = 'psyzx_lyrics_cache';
const MAX_LYRICS_CACHE = 200;

const getCachedLyrics = (trackId) => {
    try {
        const cache = JSON.parse(localStorage.getItem(LYRICS_CACHE_KEY)) || {};
        if (cache[trackId]) {
            cache[trackId].ts = Date.now(); // Update timestamp on use (LRU logic)
            localStorage.setItem(LYRICS_CACHE_KEY, JSON.stringify(cache));
            return cache[trackId].data;
        }
    } catch (e) { console.warn("Lyrics cache read error", e); }
    return null;
};

const setCachedLyrics = (trackId, lyricsData) => {
    try {
        let cache = JSON.parse(localStorage.getItem(LYRICS_CACHE_KEY)) || {};
        cache[trackId] = { ts: Date.now(), data: lyricsData };

        let keys = Object.keys(cache);
        if (keys.length > MAX_LYRICS_CACHE) {
            // Sort by oldest timestamp
            keys.sort((a, b) => cache[a].ts - cache[b].ts);
            // Evict oldest until we hit the max limit
            while (keys.length > MAX_LYRICS_CACHE) {
                delete cache[keys.shift()];
            }
        }
        localStorage.setItem(LYRICS_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { console.warn("Lyrics cache write error", e); }
};

// Helper to clean song titles for better search results
const cleanSongString = (input) => {
    if (!input) return "";
    return input.replace(/(\s-\sremastered.*|\s-\sradio edit|\s\(feat\..*|\s\[.*\]|\s\(.*version\))/gi, "").trim();
};

// LRC Parser logic to convert raw text into your { t: 0, text: "Lyric" } format
const parseLRC = (lrcText) => {
    if (!lrcText) return null;
    const lines = lrcText.split('\n');
    const parsedLyrics = [];
    const timeRegex = /\[(\d+):(\d+(?:\.\d+)?)\]/;

    for (const line of lines) {
        const match = timeRegex.exec(line);
        if (match) {
            const minutes = parseFloat(match[1]);
            const seconds = parseFloat(match[2]);
            const cleanText = line.replace(timeRegex, "").trim();
            if (cleanText) {
                parsedLyrics.push({ t: (minutes * 60) + seconds, text: cleanText });
            }
        }
    }
    return parsedLyrics.length > 0 ? parsedLyrics : null;
};

/**
 * Helper to fetch with a strict timeout.
 * Prevents dead/hanging APIs from stalling the waterfall.
 */
const fetchWithTimeout = async (url, options = {}, timeoutMs = 4000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
};

export const fetchLyricsOnFrontend = async (trackId, artist, title) => {
    if (!trackId || !artist || !title) throw new Error("Missing required track metadata.");

    // 1. Check Cache First
    const cached = getCachedLyrics(trackId);
    if (cached) return cached;

    const cleanArtist = cleanSongString(artist);
    const cleanTitle = cleanSongString(title);
    const query = encodeURIComponent(`${cleanArtist} ${cleanTitle}`);
    
    let lyricsText = null;
    let isSynced = false;

    // --- The Waterfall Array ---
    // Ranked from most reliable/useful to least.
    const mirrors = [
        // 1. LRCLIB (The Gold Standard)
        // Why it's #1: Lightning fast, open, and provides perfectly synced LRC data.
        async () => {
            const res = await fetchWithTimeout(`https://lrclib.net/api/search?q=${query}`);
            if (!res.ok) return null;
            const data = await res.json();
            const track = data.find(i => i.syncedLyrics) || data.find(i => i.plainLyrics);
            if (track?.syncedLyrics) isSynced = true;
            return track?.syncedLyrics || track?.plainLyrics || null;
        },

        // 2. Genius (via some-random-api proxy)
        // Why it's #2: Genius has the largest catalog of plain lyrics on earth. 
        // Note: We use a scraper proxy because official Genius API blocks frontend CORS and lacks raw text.
        async () => {
            const res = await fetchWithTimeout(`https://some-random-api.com/lyrics?title=${query}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data?.lyrics || null;
        },

        // 3. Lyrics.ovh 
        // Why it's #3: The oldest reliable fallback for plain lyrics. Strict URL structure.
        async () => {
            const res = await fetchWithTimeout(`https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data?.lyrics || null;
        },

        // 4. Lyrist
        // Why it's #4: A modern Vercel-hosted wrapper that scrapes multiple smaller sources.
        async () => {
            const res = await fetchWithTimeout(`https://lyrist.vercel.app/api/${query}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data?.lyrics || null;
        },

        // 5. Popcat API
        // Why it's #5: Often goes down or rate-limits heavily, but good as a last resort.
        async () => {
            const res = await fetchWithTimeout(`https://api.popcat.xyz/lyrics?song=${query}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data?.lyrics || null;
        }
    ];

    // --- Execute Waterfall ---
    for (const fetchMirror of mirrors) {
        try {
            lyricsText = await fetchMirror();
            // If we found valid text, break out of the loop immediately
            if (lyricsText && typeof lyricsText === 'string' && lyricsText.trim().length > 0) {
                break;
            }
        } catch (e) {
            // Silently swallow fetch timeouts, CORS errors, or JSON parse errors 
            // and seamlessly move to the next mirror.
            console.warn("Lyrics mirror failed, trying next...");
        }
    }

    // --- Parse and Format ---
    if (lyricsText) {
        let finalLyrics = null;

        // Only try to parse as LRC if it actually came from LRCLIB as synced
        if (isSynced && typeof parseLRC === 'function') {
            finalLyrics = parseLRC(lyricsText);
        }

        // Fallback for Plain Lyrics (Genius, OVH, Lyrist, Popcat)
        if (!finalLyrics || finalLyrics.length === 0) {
            const lines = lyricsText.split('\n').filter(l => l.trim().length > 0);
            // Simulating timestamps for plain text (3 seconds per line)
            finalLyrics = lines.map((l, i) => ({ t: i * 3, text: l.trim() }));
        }
        
        // 2. Save result to Cache
        if (typeof setCachedLyrics === 'function') {
            setCachedLyrics(trackId, finalLyrics);
        }
        
        return finalLyrics;
    }

    throw new Error("Lyrics not found across all mirrors.");
};

export const api = {
    baseUrl: '/api',

    async fetchWithTimeout(endpoint, options = {}) {
        const timeout = 5000;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                credentials: 'include', 
                ...options,
                signal: controller.signal
            });
            clearTimeout(id);

            if (response.status === 401 || response.status === 403) {
                throw new Error('UNAUTHORIZED');
            }

            return response;
        } catch (error) {
            clearTimeout(id);
            if (error.message === 'UNAUTHORIZED') {
                throw error;
            }
            if (error.name === 'AbortError') {
                throw new Error('TIMEOUT');
            }
            throw new Error('NETWORK_ERROR');
        }
    },

    async checkAuth() {
        try {
            const res = await this.fetchWithTimeout('/Auth/check');
            if (res.ok) {
                const data = await res.json();
                currentUser.set(data);
                try { await this.startSync(); } catch(e) { console.warn("Sync error", e); }
                return true;
            }
            currentUser.set(null);
            return false;
        } catch {
            currentUser.set(null);
            return false;
        }
    },

    async login(formData) {
        try {
            const res = await this.fetchWithTimeout('/Auth/login', {
                method: 'POST',
                body: JSON.stringify(formData),
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (res.ok) {
                const data = await res.json();
                currentUser.set(data);
                // Protect the sync call so it doesn't crash the login flow
                try { 
                    await this.startSync(); 
                } catch (syncErr) {
                    console.warn('[API] Sync failed to start, but login succeeded.', syncErr);
                }
            }
            // Return the raw response so Svelte can accurately check res.ok and res.status
            return res; 
        } catch (error) {
            console.error('[API] Login Fetch Error:', error);
            throw error; // Let the UI handle network errors gracefully
        }
    },

    async logout() {
        try {
            await this.fetchWithTimeout('/Auth/logout', { method: 'POST' });
        } catch { /* ignore */ }
        await this.stopSync();
        currentUser.set(null);
    },

    async register(formData) {
        try {
            const res = await this.fetchWithTimeout('/Auth/register', {
                method: 'POST',
                body: JSON.stringify(formData),
                headers: { 'Content-Type': 'application/json' }
            });
            // Return the raw response so Svelte can check res.ok
            return res; 
        } catch (error) {
            console.error('[API] Register Fetch Error:', error);
            throw error;
        }
    },

    async getArtistStats() {
        try {
            const res = await this.fetchWithTimeout('/Library/artists/stats');
            if (!res.ok) throw new Error();
            return await res.json();
        } catch {
            return [];
        }
    },

    async getTracks() {
        try {
            const res = await this.fetchWithTimeout('/Tracks');
            if (!res.ok) {
                if (res.status === 503) {
                    const data = await res.json();
                    if (data.offlineMode) return [];
                }
                throw new Error('SERVER_ERROR');
            }
            return await res.json();
        } catch (e) {
            if (e.message === 'TIMEOUT' || e.message === 'NETWORK_ERROR') {
                try {
                    const cache = await caches.open('psyzx-data-v10'); 
                    const cachedRes = await cache.match(`${this.baseUrl}/Tracks`, { ignoreSearch: true });
                    if (cachedRes) {
                        return await cachedRes.json();
                    }
                } catch (cacheErr) {}
                throw new Error('OFFLINE_NO_CACHE');
            }
            throw e;
        }
    },

    async getPlaylists() {
        try {
            const res = await this.fetchWithTimeout('/Playlists');
            if (!res.ok) throw new Error('SERVER_ERROR');
            return await res.json();
        } catch {
            return [];
        }
    },

    async getPlaylist(id) {
        try {
            const res = await this.fetchWithTimeout(`/Playlists/${id}`);
            if (!res.ok) throw new Error('SERVER_ERROR');
            return await res.json();
        } catch {
            return null;
        }
    },

    async createPlaylist(name) {
        try {
            const res = await this.fetchWithTimeout('/Playlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (!res.ok) throw new Error('SERVER_ERROR');
            return await res.json();
        } catch {
            throw new Error('CREATE_FAILED');
        }
    },

    async deletePlaylist(id) {
        try {
            const res = await this.fetchWithTimeout(`/Playlists/${id}`, { method: 'DELETE' });
            return res.ok;
        } catch {
            return false;
        }
    },

    async addToPlaylist(playlistId, trackId) {
        try {
            const res = await this.fetchWithTimeout(`/Playlists/${playlistId}/tracks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackId })
            });
            return res.ok;
        } catch {
            return false;
        }
    },

    async removeTrackFromPlaylist(playlistId, trackId) {
        try {
            const res = await this.fetchWithTimeout(`/Playlists/${playlistId}/tracks`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackId })
            });
            return res.ok;
        } catch {
            return false;
        }
    },

    async toggleFavorite(trackId, isFavorite) {
    try {
            // Use the new endpoints we just created
            const endpoint = isFavorite ? '/Playlists/add-by-name' : '/Playlists/remove-by-name';
            const method = isFavorite ? 'POST' : 'DELETE';

            const res = await this.fetchWithTimeout(endpoint, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                // Pass "Favorites" as the name here
                body: JSON.stringify({ trackId, playlistName: 'Favorites' })
            });
            
            return res.ok;
        } catch (err) {
            console.error("[API] Failed to update favorite status", err);
            return false;
        }
    },

    async scanLibrary(hardScan = false) {
        try {
            const endpoint = `/System/scan${hardScan ? '?hardScan=true' : ''}`;
            return await this.fetchWithTimeout(endpoint, { method: 'POST' });
        } catch (e) {
            throw new Error('OFFLINE');
        }
    },

    async getStats() {
        try {
            const res = await this.fetchWithTimeout('/Tracks/stats');
            if (!res.ok) throw new Error();
            return await res.json();
        } catch {
            throw new Error('OFFLINE');
        }
    },

    async getQueue() {
        try {
            const res = await this.fetchWithTimeout('/System/queue');
            if (!res.ok) throw new Error();
            return await res.json();
        } catch {
            throw new Error('OFFLINE');
        }
    },

    async ytdlp(data) {
        try {
            const res = await this.fetchWithTimeout('/System/ytdlp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const json = await res.json();
            return { ok: res.ok, data: json };
        } catch {
            throw new Error('NETWORK_ERROR');
        }
    },

    async stopQueue() {
        try {
            const res = await this.fetchWithTimeout('/System/stop', { method: 'POST' });
            return await res.json();
        } catch {
            throw new Error('NETWORK_ERROR');
        }
    },

    async getLyrics(id) {
        try {
            if (!id) return null;
            const res = await this.fetchWithTimeout(`/Tracks/lyrics/${id}`);
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            return null;
        }
    },

    async updateArtist(id, formData) {
        try {
            const response = await this.fetchWithTimeout(`/System/artist/${id}`, {
                method: 'PUT',
                body: formData 
            });
            return response.ok;
        } catch (err) {
            return false;
        }
    },

    async updateAlbum(id, title, coverPath) {
        try {
            const res = await this.fetchWithTimeout(`/System/album/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, coverPath })
            });
            return res.ok;
        } catch {
            return false;
        }
    },

    async getRadioMix(seedTrackId, excludeIds = []) {
        try {
            const excludeString = excludeIds.join(',');
            const res = await this.fetchWithTimeout(`/Tracks/radio/${seedTrackId}?limit=10&excludeIds=${excludeString}`);
            if (!res.ok) return [];
            return await res.json();
        } catch {
            return []; 
        }
    },

    async recordPlay(trackId, payload = {}) {
        try {
            // Use native fetch with keepalive to survive page unloads
            fetch(`${this.baseUrl}/Tracks/${trackId}/play`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true
            }).catch(e => console.error("[API] Failed to record play:", e));
        } catch (e) {
            console.error("[API] Failed to record play:", e);
        }
    },

    async getWrappedStats(duration = 'month') {
        try {
            const res = await this.fetchWithTimeout(`/Tracks/wrapped?duration=${duration}`);
            if (!res.ok) throw new Error('Failed to load wrapped stats');
            return await res.json();
        } catch (e) {
            console.error("[API] getWrappedStats error:", e);
            return null;
        }
    },

    async startSync() {
        try {
            await initSync(
                () => {
                    // Replaced undefined variables with safe fallbacks
                    return {
                        trackUrl: null,
                        currentTime: activePlayer ? activePlayer.currentTime : 0,
                        isPlaying: get(isPlaying),
                        timestamp: Date.now(),
                    };
                },
                (state) => { console.log('Remote state applied:', state); }
            );
        } catch (e) {
            console.warn('[Sync] Could not initialize sync', e);
        }
    },
    
    async stopSync() {
        await stopSync();
    },
};