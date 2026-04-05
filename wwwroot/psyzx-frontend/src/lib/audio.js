export let audioCtx;
export let gainNode;
let globalAudioEl = null;

let eqFilters = [];
const EQ_FREQS = [60, 250, 1000, 4000, 8000, 14000];
let isEngineInitialized = false;

export const primeEngine = async () => {
    if (!audioCtx) initAudioEngine();
    if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
        console.log("🔊 System Level Audio Unlocked");
    }
};

export const registerAudioElement = (el) => {
    globalAudioEl = el;
};

export const unlockAudioContext = async () => {
    if (!audioCtx) {
        initAudioEngine();
    }
    
    if (audioCtx && audioCtx.state === 'suspended') {
        try {
            await audioCtx.resume();
            console.log("[Audio] Context Resumed via User Gesture");
        } catch (e) {
            console.error("[Audio] Resume failed:", e);
        }
    }
};

export const initAudioEngine = () => {
    if (typeof window === 'undefined' || !globalAudioEl || isEngineInitialized) return;
    
    try {
        const AudioCtx = window.AudioContext || window['webkitAudioContext'];
        if (!AudioCtx) return;
        
        // Use a single instance
        if (!audioCtx) audioCtx = new AudioCtx();
        
        gainNode = audioCtx.createGain();
        
        eqFilters = EQ_FREQS.map(freq => {
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1.4;
            filter.gain.value = 0;
            return filter;
        });
        
        const source = audioCtx.createMediaElementSource(globalAudioEl);
        source.connect(gainNode);
        
        let lastNode = gainNode;
        eqFilters.forEach(f => {
            lastNode.connect(f);
            lastNode = f;
        });
        lastNode.connect(audioCtx.destination);
        
        isEngineInitialized = true;
    } catch (e) {
        console.error("[Audio] Engine Init Error:", e);
    }
};

export const setVolumeBoost = (val) => {
    const num = parseFloat(val);
    if (!isEngineInitialized && num !== 1.0) initAudioEngine();
    if (gainNode) gainNode.gain.value = num;
};

export const setEqBand = (index, val) => {
    if (!isEngineInitialized) initAudioEngine();
    if (eqFilters[index]) {
        eqFilters[index].gain.value = parseFloat(val);
    }
};

export const updateMediaSession = (track, album, handlers) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !window.MediaMetadata || !track) return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || 'Unknown Title',
            artist: album?.artistName || 'Unknown Artist',
            album: album?.title || 'Unknown Album',
            artwork: [
                { 
                    src: album?.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : '', 
                    sizes: '512x512', 
                    type: 'image/jpeg' 
                }
            ]
        });

        navigator.mediaSession.setActionHandler('play', handlers.play);
        navigator.mediaSession.setActionHandler('pause', handlers.pause);
        navigator.mediaSession.setActionHandler('previoustrack', handlers.prev);
        navigator.mediaSession.setActionHandler('nexttrack', handlers.next);
        navigator.mediaSession.setActionHandler('seekbackward', () => { handlers.seekRelative(-10); });
        navigator.mediaSession.setActionHandler('seekforward', () => { handlers.seekRelative(10); });
    } catch (e) {}
};