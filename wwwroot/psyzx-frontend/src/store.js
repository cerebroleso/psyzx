import { writable } from 'svelte/store';

export const allTracks = writable([]);
export const artistsMap = writable(new Map());
export const albumsMap = writable(new Map());

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
    return false;
};

const getInitialSwapMode = () => {
    if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('psyzx_desktop_swap');
        if (saved !== null) return saved === 'true';
    }
    return false;
};

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