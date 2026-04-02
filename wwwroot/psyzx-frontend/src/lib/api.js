export const api = {
    baseUrl: '/api',

    async fetchWithTimeout(endpoint, options = {}) {
        const timeout = 5000;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                credentials: 'include', // <-- QUESTO RESTA: è vitale per i cookie su Cloudflare/Mobile
                ...options,
                signal: controller.signal
            });
            clearTimeout(id);

            if (response.status === 401 || response.status === 403) {
                // NIENTE PIÙ REDIRECT AUTOMATICO = NIENTE LOOP INFINITO
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
            return res.ok;
        } catch {
            return false;
        }
    },

    async login(formData) {
        try {
            return await this.fetchWithTimeout('/Auth/login', {
                method: 'POST',
                body: new URLSearchParams(formData),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
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
                throw new Error('Errore server');
            }
            return await res.json();
        } catch (e) {
            if (e.message === 'TIMEOUT' || e.message === 'NETWORK_ERROR') {
                try {
                    const cache = await caches.open('psyzx-data-v8'); // Aggiornato alla v8
                    const cachedRes = await cache.match(`${this.baseUrl}/Tracks`, { ignoreSearch: true });
                    if (cachedRes) {
                        return await cachedRes.json();
                    }
                } catch (cacheErr) {}
                
                throw new Error('Sei offline e non ci sono dati in cache.');
            }
            throw e;
        }
    },

    async scanLibrary() {
        try {
            return await this.fetchWithTimeout('/System/scan', { method: 'POST' });
        } catch (e) {
            throw new Error('Impossibile scansionare offline');
        }
    },

    async getStats() {
        try {
            const res = await this.fetchWithTimeout('/Tracks/stats');
            if (!res.ok) throw new Error();
            return await res.json();
        } catch {
            throw new Error('Offline');
        }
    },

    async getQueue() {
        try {
            const res = await this.fetchWithTimeout('/System/queue');
            if (!res.ok) throw new Error();
            return await res.json();
        } catch {
            throw new Error('Offline');
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

    async getLyrics(artist, title) {
        try {
            if (!artist || !title) return null;
            const url = `/System/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`;
            const res = await this.fetchWithTimeout(url);
            
            if (!res.ok) return null;
            const data = await res.json();
            return data.lrc;
        } catch {
            return null;
        }
    },

    async updateArtist(id, name, imagePath) {
        try {
            const res = await this.fetchWithTimeout(`/System/artist/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, imagePath })
            });
            return res.ok;
        } catch {
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
    }
};