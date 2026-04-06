export let audioCtx;
export let gainNode;
let eqFilters = [];
let globalAudioEl = null;
let silentAnchorEl = null;
let sourceNode = null;
let heartbeatOsc = null;
let mixerNode = null;
let isEngineInitialized = false;
let isInitializing = false;

let pendingBoost = 1.0;
let pendingEq = [0, 0, 0, 0, 0, 0];

const EQ_FREQS = [60, 250, 1000, 4000, 8000, 14000];
const SILENCE_B64 = "data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAP8H";

const initSilentAnchor = () => {
    if (silentAnchorEl) return;
    silentAnchorEl = new Audio();
    silentAnchorEl.src = SILENCE_B64;
    silentAnchorEl.loop = true;
    silentAnchorEl.setAttribute("playsinline", "true");
    silentAnchorEl.volume = 0.01;
};

export const initAudioEngine = async () => {
    if (typeof window === 'undefined' || !globalAudioEl || isEngineInitialized || isInitializing) return;
    isInitializing = true; 

    try {
        const AudioCtx = window.AudioContext || window['webkitAudioContext'];
        if (!audioCtx) audioCtx = new AudioCtx();
        
        initSilentAnchor();

        if (!mixerNode) {
            mixerNode = audioCtx.createGain();
            mixerNode.gain.value = 1.0;
        }

        if (!sourceNode) {
            sourceNode = audioCtx.createMediaElementSource(globalAudioEl);
            sourceNode.connect(mixerNode);
        }

        if (!heartbeatOsc) {
            const hGain = audioCtx.createGain();
            hGain.gain.value = 0.0000001; 
            heartbeatOsc = audioCtx.createOscillator();
            heartbeatOsc.type = 'sine';
            heartbeatOsc.frequency.value = 440;
            heartbeatOsc.connect(hGain);
            hGain.connect(mixerNode);
            heartbeatOsc.start();
        }

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

        document.addEventListener('visibilitychange', () => {
            if (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted') {
                audioCtx.resume();
            }
        });

        isEngineInitialized = true;
    } catch (e) {
        console.error(e);
    } finally {
        isInitializing = false;
    }
};

export const primeEngine = async () => {
    if (!isEngineInitialized) await initAudioEngine();
    if (audioCtx?.state === 'suspended') await audioCtx.resume();
};

export const unlockAudioContext = async () => {
    await primeEngine();
    if (silentAnchorEl && silentAnchorEl.paused) {
        silentAnchorEl.play().catch(() => {});
    }
};

export const registerAudioElement = (el) => {
    globalAudioEl = el;
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
        artwork: [{ src: album?.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : '', sizes: '512x512', type: 'image/jpeg' }]
    });

    navigator.mediaSession.setActionHandler('play', async () => {
        await unlockAudioContext();
        handlers.play();
    });
    
    navigator.mediaSession.setActionHandler('pause', () => {
        handlers.pause();
        if (silentAnchorEl) silentAnchorEl.pause();
    });

    navigator.mediaSession.setActionHandler('previoustrack', handlers.prev);
    navigator.mediaSession.setActionHandler('nexttrack', handlers.next);
};