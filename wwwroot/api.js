export const api = {
    checkAuth: async () => {
        const res = await fetch('/api/auth/check');
        return res.status !== 401;
    },
    login: async (fd) => {
        return await fetch('/api/auth/login', { method: 'POST', body: fd });
    },
    getTracks: async () => {
        const res = await fetch('/api/Tracks');
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return await res.json();
    },
    scanLibrary: async () => {
        return await fetch('/api/System/scan', { method: 'POST' });
    },
    getStats: async () => {
        const res = await fetch('/api/System/stats');
        return await res.json();
    },
    getQueue: async () => {
        const res = await fetch('/api/System/queue');
        if (res.ok) return await res.json();
        return null;
    },
    ytdlp: async (body) => {
        const res = await fetch('/api/System/ytdlp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return { ok: res.ok, data: await res.json() };
    },
    stopQueue: async () => {
        const res = await fetch('/api/System/stop', { method: 'POST' });
        return await res.json();
    },
    getLyrics: async (id) => {
        try {
            const res = await fetch(`/api/Tracks/lyrics/${id}`);
            if (res.ok) return await res.text();
            return null;
        } catch { return null; }
    }
};