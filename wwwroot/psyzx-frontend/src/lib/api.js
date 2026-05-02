import { currentUser } from '../store.js';
import { initSync, stopSync, broadcastState } from './sync.js';
import { activePlayer } from './audio.js';
import { get } from 'svelte/store';
import { isPlaying, playerCurrentTime, playlistUpdateSignal, appSessionVersion } from '../store.js';
import {
            saveOfflineCredentials,
            refreshOfflineUserData,
            verifyOfflineLogin,
            hasOfflineCredentials,
            clearOfflineCredentials,
        } from './offlineAuth.js';


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
    let cleaned = input.replace(/(\s-\sremastered.*|\s-\sradio edit|\s\(feat\..*|\s\[.*\]|\s\(.*version\)|\(official video\)|\(official audio\)|\(official lyric video\)|\(demo\)|\(live\)|\(acoustic\))/gi, "").trim();
    // Remove leading track numbers like "01. ", "1. ", "10-", etc.
    cleaned = cleaned.replace(/^\d+[\s.-]+/, "");
    return cleaned;
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
            const timestamp = (minutes * 60) + seconds;
            const cleanText = line.replace(timeRegex, "").trim();
            if (cleanText) {
                // WS10: Filter out metadata lines that sit at t=0 and contain only
                // symbols, brackets, or placeholder chars like ♪ — these highlight
                // immediately before the singer starts, causing the "out of sync" feel.
                if (timestamp < 0.5 && /^[♪♫♬◆\[\]\(\)\{\}\-_~*\s]+$/.test(cleanText)) {
                    continue;
                }
                parsedLyrics.push({ t: timestamp, text: cleanText });
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

    console.debug("[Lyrics] Raw metadata:", { artist, title });
    const cleanArtist = cleanSongString(artist);
    const cleanTitle = cleanSongString(title);
    console.debug("[Lyrics] Cleaned metadata:", { cleanArtist, cleanTitle });
    
    let lyricsText = null;
    let isSynced = false;

    const attemptFetch = async (a, t, typeLabel) => {
        const query = encodeURIComponent(`${a} ${t}`);
        const encA = encodeURIComponent(a);
        const encT = encodeURIComponent(t);

        const providers = [
            {
                name: "LRCLIB",
                fn: async () => {
                    const res = await fetchWithTimeout(`https://lrclib.net/api/search?q=${query}`);
                    if (!res.ok) return null;
                    const data = await res.json();
                    const track = data.find(i => i.syncedLyrics) || data.find(i => i.plainLyrics);
                    if (track?.syncedLyrics) isSynced = true;
                    return track?.syncedLyrics || track?.plainLyrics || null;
                }
            },
            {
                name: "Genius",
                fn: async () => {
                    const res = await fetchWithTimeout(`https://some-random-api.com/lyrics?title=${query}`);
                    if (!res.ok) return null;
                    const data = await res.json();
                    return data?.lyrics || null;
                }
            },
            {
                name: "Lyrics.ovh",
                fn: async () => {
                    const res = await fetchWithTimeout(`https://api.lyrics.ovh/v1/${encA}/${encT}`);
                    if (!res.ok) return null;
                    const data = await res.json();
                    return data?.lyrics || null;
                }
            },
            {
                name: "Lyrist",
                fn: async () => {
                    const res = await fetchWithTimeout(`https://lyrist.vercel.app/api/${query}`);
                    if (!res.ok) return null;
                    const data = await res.json();
                    return data?.lyrics || null;
                }
            },
            {
                name: "Popcat",
                fn: async () => {
                    const res = await fetchWithTimeout(`https://api.popcat.xyz/lyrics?song=${query}`);
                    if (!res.ok) return null;
                    const data = await res.json();
                    return data?.lyrics || null;
                }
            }
        ];

        for (const provider of providers) {
            try {
                const result = await provider.fn();
                console.debug(`[Lyrics] [${typeLabel}] Mirror ${provider.name} response:`, result ? (result.substring(0, 100) + "...") : "NOT FOUND");
                if (result && typeof result === 'string' && result.trim().length > 0) {
                    return result;
                }
            } catch (e) {
                console.debug(`[Lyrics] [${typeLabel}] Mirror ${provider.name} failed:`, e.message);
            }
        }
        return null;
    };

    // Pass 1: Cleaned search (Best for most cases)
    lyricsText = await attemptFetch(cleanArtist, cleanTitle, "CLEANED");

    // Pass 2: Raw search (Fallback if cleaned failed and is different)
    if (!lyricsText && (cleanArtist !== artist || cleanTitle !== title)) {
        console.debug("[Lyrics] Cleaned search failed, retrying with RAW metadata...");
        lyricsText = await attemptFetch(artist, title, "RAW");
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
            // WS10: Start at t=8s (typical song intro) with 5s per line for a more
            // realistic pace. This avoids the first lyric highlighting during the
            // instrumental intro, which felt out of sync with the actual vocals.
            finalLyrics = lines.map((l, i) => ({ t: 8 + (i * 5), text: l.trim() }));
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
                // Keep the cached user profile fresh so offline logins stay current
                refreshOfflineUserData(data);
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
    
                // ── Save credentials for future offline use ──
                // Fire-and-forget: PBKDF2 is async but we don't want to stall the
                // login transition on a 200k-iteration hash.
                saveOfflineCredentials(formData.username, formData.password, data)
                    .catch(e => console.warn('[API] Offline credential save failed:', e));
    
                try {
                    await this.startSync();
                } catch (syncErr) {
                    console.warn('[API] Sync failed to start, but login succeeded.', syncErr);
                }
            }
    
            // Return the raw response so AuthModal can check res.ok / res.status
            return res;
    
        } catch (error) {
            // ── OFFLINE FALLBACK ──────────────────────────────────────────────────
            // Only intercept genuine network-level failures.
            // UNAUTHORIZED (401/403) is thrown separately and must NOT reach here.
            if (error.message === 'NETWORK_ERROR' || error.message === 'TIMEOUT') {
    
                // Tell the user early that we are in offline mode
                console.info('[API] Server unreachable — attempting offline login.');
    
                // Verify the entered password against the stored PBKDF2 hash
                const offlineUser = await verifyOfflineLogin(
                    formData.username,
                    formData.password
                );
    
                if (offlineUser) {
                    currentUser.set(offlineUser);
                    // Return a duck-typed response object that AuthModal already
                    // handles via `res.ok === true`
                    return { ok: true, offline: true };
                }
    
                // Credentials exist but password was wrong
                if (hasOfflineCredentials()) {
                    return {
                        ok: false,
                        message: 'Incorrect password (you are offline — server is unreachable).',
                    };
                }
    
                // No prior login on this device at all
                return {
                    ok: false,
                    message: 'You are offline. Connect once to enable offline access.',
                };
            }
    
            // Re-throw anything that is not a network failure (e.g. UNAUTHORIZED)
            throw error;
        }
    },


    async logout() {
        try {
            await this.fetchWithTimeout('/Auth/logout', { method: 'POST' });
        } catch { /* ignore — we still clear local state */ }
    
        await this.stopSync();
        currentUser.set(null);
    
        // Wipe stored credentials so someone else can't bypass login on
        // a shared device after the owner has explicitly logged out.
        clearOfflineCredentials();
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
            const res = await this.fetchWithTimeout(`/Tracks?v=${get(appSessionVersion)}`);
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
            const res = await this.fetchWithTimeout(`/Playlists?v=${get(appSessionVersion)}&_t=${Date.now()}`);
            if (!res.ok) throw new Error('SERVER_ERROR');
            return await res.json();
        } catch {
            return [];
        }
    },

    async getPlaylist(id) {
        try {
            const res = await this.fetchWithTimeout(`/Playlists/${id}?v=${get(appSessionVersion)}&_t=${Date.now()}`);
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
            playlistUpdateSignal.update(n => n + 1);
            return await res.json();
        } catch {
            throw new Error('CREATE_FAILED');
        }
    },

    async deletePlaylist(id) {
        try {
            const res = await this.fetchWithTimeout(`/Playlists/${id}`, { method: 'DELETE' });
            if (res.ok) playlistUpdateSignal.update(n => n + 1);
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
            if (res.ok) {
                playlistUpdateSignal.update(n => n + 1);
                // WS4: Fire event so mounted Playlist components refresh immediately
                window.dispatchEvent(new CustomEvent('playlist-tracks-changed', { detail: { playlistId } }));
            }
            return res.ok;
        } catch {
            return false;
        }
    },

    async addTracksToPlaylist(playlistId, trackIds) {
        let successCount = 0;
        for (const trackId of trackIds) {
            try {
                const res = await this.fetchWithTimeout(`/Playlists/${playlistId}/tracks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trackId })
                });
                if (res.ok) successCount++;
            } catch { /* continue with remaining tracks */ }
        }
        if (successCount > 0) {
            playlistUpdateSignal.update(n => n + 1);
            // WS4: Fire event so mounted Playlist components refresh immediately
            window.dispatchEvent(new CustomEvent('playlist-tracks-changed', { detail: { playlistId } }));
        }
        return successCount;
    },

    async removeTrackFromPlaylist(playlistId, trackId) {
        try {
            const res = await this.fetchWithTimeout(`/Playlists/${playlistId}/tracks`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackId })
            });
            if (res.ok) playlistUpdateSignal.update(n => n + 1);
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
            const res = await this.fetchWithTimeout(`/Tracks/stats?v=${get(appSessionVersion)}`);
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