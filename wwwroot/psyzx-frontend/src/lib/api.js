import { currentUser } from '../store.js';

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
                body: new URLSearchParams(formData),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            if (res.ok) {
                const data = await res.json();
                currentUser.set(data);
                return { ok: true, data };
            }
            return { ok: false };
        } catch {
            return { ok: false };
        }
    },

    async register(formData) {
        try {
            const res = await this.fetchWithTimeout('/Auth/register', {
                method: 'POST',
                body: new URLSearchParams(formData),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            return { ok: res.ok };
        } catch {
            return { ok: false };
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
            const tracks = await res.json();
            
            return tracks;
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

    async scanLibrary(hardScan = false) {
        try {
            // Appending the flag as a query string so the ASP.NET controller can bind it
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
            // We don't await the result because we don't want to block the UI
            this.fetchWithTimeout(`/Tracks/${trackId}/play`, { method: 'POST' });
        } catch (e) {
            console.error("[API] Failed to record play:", e);
        }
    },
};