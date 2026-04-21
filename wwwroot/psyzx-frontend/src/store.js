import { writable } from 'svelte/store';

export const currentUser = writable(null);

export const allTracks = writable([]);
export const artistsMap = writable(new Map());
export const albumsMap = writable(new Map());

// SSR-Safe Initializations
export const viewSize = writable(typeof window !== 'undefined' ? localStorage.getItem('psyzx_view_size') || 'medium' : 'medium');
export const isLowQualityImages = writable(typeof window !== 'undefined' ? localStorage.getItem('psyzx_low_res') === 'true' : false);
export const audioBitrate = writable(typeof window !== 'undefined' ? localStorage.getItem('psyzx_bitrate') || '320' : '320');

export const currentPlaylist = writable([]);
export const currentIndex = writable(0);
export const isPlaying = writable(false);

export const isShuffle = writable(false);
export const isRepeat = writable(false);
export const shuffleHistory = writable([]);
export const shuffleFuture = writable([]);
export const userQueue = writable([]);

export const appSessionVersion = writable(Date.now());
export const playlistUpdateSignal = writable(0);

export const playerCurrentTime = writable(0);
export const playerDuration = writable(0);

export const accentColor = writable('rgb(181, 52, 209)');

export const totalCacheSize = writable('0 MB');
export const cachedTrackIds = writable(new Set());

export const isBuffering = writable(false);

export const globalBitrate = writable(0);
export const globalFileExt = writable('');

// Subscriptions with SSR Guards
isLowQualityImages.subscribe(val => {
    if (typeof window !== 'undefined') localStorage.setItem('psyzx_low_res', val.toString());
});

audioBitrate.subscribe(val => {
    if (typeof window !== 'undefined') localStorage.setItem('psyzx_bitrate', val);
});

export const refreshOfflineCache = async () => {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    
    // Kept hardcoded as requested
    const cache = await caches.open('psyzx-media-v10'); 
    const keys = await cache.keys();
    const newIds = new Set();
    let totalBytes = 0;

    for (const request of keys) {
        const parts = request.url.split('?')[0].split('/');
        const id = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(id)) newIds.add(id);

        const response = await cache.match(request);
        if (response) {
            const size = response.headers.get('content-length');
            if (size) {
                totalBytes += parseInt(size, 10);
            } else {
                // Fallback for opaque responses (cors issues hiding size)
                totalBytes += 5 * 1024 * 1024; 
            }
        }
    }

    cachedTrackIds.set(newIds);
    
    const mb = totalBytes / (1024 * 1024);
    if (mb > 1024) {
        totalCacheSize.set(`${(mb / 1024).toFixed(2)} GB`);
    } else {
        totalCacheSize.set(`${mb.toFixed(1)} MB`);
    }
};

refreshOfflineCache();

// Helpers for initial state
const getStorageBool = (key, defaultVal) => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(key);
        if (saved !== null) return saved === 'true';
    }
    return defaultVal;
};

const getStorageString = (key, defaultVal) => {
    if (typeof window !== 'undefined') {
        return localStorage.getItem(key) || defaultVal;
    }
    return defaultVal;
};

export const isCacheDebugActive = writable(getStorageBool('psyzx_cache_debug', false));
export const isGaplessModeActive = writable(getStorageBool('psyzx_gapless', false));
export const isGlobalColorActive = writable(getStorageBool('psyzx_global_color', false));
export const isMaxGlassActive = writable(getStorageBool('psyzx_max_glass', true));
export const isDesktopSwapActive = writable(getStorageBool('psyzx_desktop_swap', true));

// Visualizer Stores (Moved from component to global state)
export const visEnabled = writable(getStorageBool('psyzx_vis_enabled', true));
export const visIntensity = writable(getStorageString('psyzx_vis_intensity', '0.3'));
export const visShape = writable(getStorageString('psyzx_vis_shape', 'PSPWaves'));
export const visMovement = writable(getStorageString('psyzx_vis_movement', 'Hypnotic'));
export const visYPos = writable(getStorageString('psyzx_vis_ypos', '10'));
export const visDimension = writable(getStorageString('psyzx_vis_dimension', '1.0'));
export const visDetail = writable(getStorageString('psyzx_vis_detail', '16'));
export const visSides = writable(getStorageString('psyzx_vis_sides', 'Default'));

// Batch subscriptions for UI settings
const bindToLocal = (store, key, dispatchVisUpdate = false) => {
    store.subscribe(val => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(key, val.toString());
            if (dispatchVisUpdate) window.dispatchEvent(new CustomEvent('visualizer-update'));
        }
    });
};

bindToLocal(isGaplessModeActive, 'psyzx_gapless');
bindToLocal(isCacheDebugActive, 'psyzx_cache_debug');
bindToLocal(isGlobalColorActive, 'psyzx_global_color');
bindToLocal(isMaxGlassActive, 'psyzx_max_glass');
bindToLocal(isDesktopSwapActive, 'psyzx_desktop_swap');

bindToLocal(visEnabled, 'psyzx_vis_enabled', true);
bindToLocal(visIntensity, 'psyzx_vis_intensity', true);
bindToLocal(visShape, 'psyzx_vis_shape', true);
bindToLocal(visMovement, 'psyzx_vis_movement', true);
bindToLocal(visYPos, 'psyzx_vis_ypos', true);
bindToLocal(visDimension, 'psyzx_vis_dimension', true);
bindToLocal(visDetail, 'psyzx_vis_detail', true);
bindToLocal(visSides, 'psyzx_vis_sides', true);

// eq

// Helper to get JSON from localStorage safely
const getStorageJSON = (key, defaultVal) => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(key);
        try {
            return saved ? JSON.parse(saved) : defaultVal;
        } catch (e) {
            return defaultVal;
        }
    }
    return defaultVal;
};

export const eqPreset = writable(getStorageString('psyzx_eq_preset', 'Flat'));
export const eqBandValues = writable(getStorageJSON('psyzx_eq_bands', [0, 0, 0, 0, 0, 0]));

// Subscribe to save changes automatically
eqPreset.subscribe(val => {
    if (typeof window !== 'undefined') localStorage.setItem('psyzx_eq_preset', val);
});

eqBandValues.subscribe(val => {
    if (typeof window !== 'undefined') localStorage.setItem('psyzx_eq_bands', JSON.stringify(val));
});