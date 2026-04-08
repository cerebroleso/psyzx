export let audioCtx;
export let gainNode;
let eqFilters = [];
let globalAudioEl = null;
let sourceNode = null;
let mixerNode = null;
export let isEngineInitialized = false;

let pendingBoost = 1.0;
let pendingEq = [0, 0, 0, 0, 0, 0];
const EQ_FREQS = [60, 250, 1000, 4000, 8000, 14000];

export const registerAudioElement = (el) => {
    globalAudioEl = el;
};

// Strictly synchronous context unlocker
export const unlockAudioContext = () => {
    if (!audioCtx) {
        const AudioCtx = window.AudioContext || window['webkitAudioContext'];
        audioCtx = new AudioCtx();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
};

export const initAudioEngine = () => {
    // If already attached, just ensure it is awake
    if (typeof window === 'undefined' || !globalAudioEl || isEngineInitialized) {
        if (isEngineInitialized && audioCtx?.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return;
    }

    try {
        if (!audioCtx) {
            const AudioCtx = window.AudioContext || window['webkitAudioContext'];
            audioCtx = new AudioCtx();
        }

        // The iOS Hardware Hijack
        sourceNode = audioCtx.createMediaElementSource(globalAudioEl);
        mixerNode = audioCtx.createGain();
        sourceNode.connect(mixerNode);

        eqFilters = EQ_FREQS.map((freq, i) => {
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1.4;
            filter.gain.value = pendingEq[i];
            return filter;
        });

        gainNode = audioCtx.createGain();
        gainNode.gain.value = pendingBoost;

        mixerNode.connect(eqFilters[0]);
        for (let i = 0; i < eqFilters.length - 1; i++) {
            eqFilters[i].connect(eqFilters[i+1]);
        }
        eqFilters[eqFilters.length - 1].connect(gainNode);
        gainNode.connect(audioCtx.destination);

        isEngineInitialized = true;
    } catch (e) {
        console.error("[Audio] Graph connection failed:", e);
    }
};

export const setVolumeBoost = (val) => {
    const num = parseFloat(val);
    pendingBoost = num;
    if (gainNode && audioCtx) {
        gainNode.gain.setTargetAtTime(num, audioCtx.currentTime, 0.02);
    }
};

export const setEqBand = (index, val) => {
    const num = parseFloat(val);
    pendingEq[index] = num;
    if (eqFilters[index] && audioCtx) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        eqFilters[index].gain.setTargetAtTime(num, audioCtx.currentTime, 0.02);
    }
};

export const updateMediaSession = (track, album, handlers) => {
    if (!track || !('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: album?.artistName,
        album: album?.title,
        artwork: [{ src: album?.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&size=thumb` : '', sizes: '512x512', type: 'image/jpeg' }]
    });

    navigator.mediaSession.setActionHandler('pause', () => {
        handlers.pause();
    });

    navigator.mediaSession.setActionHandler('play', () => {
        unlockAudioContext();
        handlers.play();
    });

    if (handlers.seek) {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            handlers.seek(details.seekTime);
            if (globalAudioEl && !isNaN(globalAudioEl.duration)) {
                updateMediaPositionState(details.seekTime, globalAudioEl.duration);
            }
        });
    }

    navigator.mediaSession.setActionHandler('previoustrack', handlers.prev);
    navigator.mediaSession.setActionHandler('nexttrack', handlers.next);

    try {
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
    } catch (e) {}
};

export const updateMediaPositionState = (currentTime, duration) => {
    if ('mediaSession' in navigator && !isNaN(duration) && duration > 0) {
        try {
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: 1.0,
                position: currentTime
            });
        } catch (e) {}
    }
};