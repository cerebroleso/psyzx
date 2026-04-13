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

    async toggleFavorite(trackId, isFavorite) {
        try {
            const method = isFavorite ? 'POST' : 'DELETE';
            const res = await this.fetchWithTimeout(`/Playlists/1/tracks`, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackId })
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

    async recordPlay(trackId) {
        try {
            this.fetchWithTimeout(`/Tracks/${trackId}/play`, { method: 'POST' });
        } catch (e) {
            console.error("[API] Failed to record play:", e);
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