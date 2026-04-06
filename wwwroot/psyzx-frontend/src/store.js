import { writable } from 'svelte/store';

export const currentUser = writable(null);

export const allTracks = writable([]);
export const artistsMap = writable(new Map());
export const albumsMap = writable(new Map());
export const viewSize = writable(localStorage.getItem('psyzx_view_size') || 'medium');

export const currentPlaylist = writable([]);
export const currentIndex = writable(0);
export const isPlaying = writable(false);

export const isShuffle = writable(false);
export const isRepeat = writable(false);
export const shuffleHistory = writable([]);

export const appSessionVersion = writable(Date.now());

export const playerCurrentTime = writable(0);
export const playerDuration = writable(0);

export const accentColor = writable('rgb(181, 52, 209)');

export const totalCacheSize = writable('0 MB');
export const cachedTrackIds = writable(new Set());

export const refreshOfflineCache = async () => {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    
    // CRITICAL: Ensure this matches the name in your sw.js exactly!
    const cache = await caches.open('psyzx-media-v10'); 
    const keys = await cache.keys();
    const newIds = new Set();
    let totalBytes = 0;

    for (const request of keys) {
        // 1. Extract the ID for the list filtering
        const parts = request.url.split('?')[0].split('/');
        const id = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(id)) newIds.add(id);

        // 2. Sum the file sizes
        const response = await cache.match(request);
        if (response) {
            const size = response.headers.get('content-length');
            if (size) totalBytes += parseInt(size, 10);
        }
    }

    // Update both stores
    cachedTrackIds.set(newIds);
    
    // Formatting logic
    const mb = totalBytes / (1024 * 1024);
    if (mb > 1024) {
        totalCacheSize.set(`${(mb / 1024).toFixed(2)} GB`);
    } else {
        totalCacheSize.set(`${mb.toFixed(1)} MB`);
    }
};

// Initial scan
refreshOfflineCache();

const getInitialColorMode = () => {
    if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('psyzx_global_color');
        if (saved !== null) return saved === 'true';
    }
    return false;
};

const getInitialGlassMode = () => {
    if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('psyzx_max_glass');
        if (saved !== null) return saved === 'true';
    }
    return true;
};

const getInitialSwapMode = () => {
    if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('psyzx_desktop_swap');
        if (saved !== null) return saved === 'true';
    }
    return true;
};

const getInitialCacheDebug = () => {
    if (typeof localStorage !== 'undefined') {
        return localStorage.getItem('psyzx_cache_debug') === 'true';
    }
    return false;
};

export const isCacheDebugActive = writable(getInitialCacheDebug());

isCacheDebugActive.subscribe(val => {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('psyzx_cache_debug', val.toString());
    }
});

export const isGlobalColorActive = writable(getInitialColorMode());
export const isMaxGlassActive = writable(getInitialGlassMode());
export const isDesktopSwapActive = writable(getInitialSwapMode());

isGlobalColorActive.subscribe(val => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('psyzx_global_color', val.toString());
});

isMaxGlassActive.subscribe(val => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('psyzx_max_glass', val.toString());
});

isDesktopSwapActive.subscribe(val => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('psyzx_desktop_swap', val.toString());
});