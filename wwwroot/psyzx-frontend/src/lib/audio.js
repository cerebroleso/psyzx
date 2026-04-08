export let audioCtx;
export let gainNode;
let eqFilters = [];
export let globalAudioEl = null;
let silentAnchorEl = null;
let sourceNode = null;
let heartbeatOsc = null;
let mixerNode = null;
export let isEngineInitialized = false;
let isInitializing = false;
let stallTimeout = null;

// Export the promise so Svelte knows exactly when hardware is ready
export let resumePromise = Promise.resolve();

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
                audioCtx.resume().catch(() => {});
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
    // Background safety check
    if (audioCtx?.state === 'suspended') {
        resumePromise = audioCtx.resume().catch(() => {});
    }
};

export const unlockAudioContext = () => { 
    if (!audioCtx) {
        const AudioCtx = window.AudioContext || window['webkitAudioContext'];
        audioCtx = new AudioCtx();
    }

    // Flag that we are attempting to start the engine
    isPlayAttemptActive = true;

    if (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted') {
        resumePromise = audioCtx.resume().catch(() => {
            // If resume fails immediately, that's a deadlock
            window.dispatchEvent(new CustomEvent('ios-hardware-deadlock'));
        });
    }

    try {
        if (silentAnchorEl && silentAnchorEl.paused) {
            silentAnchorEl.play().catch(() => {});
        }
    } catch (e) {}

    primeEngine();
};

let isPlayAttemptActive = false;

export const registerAudioElement = (el) => {
    globalAudioEl = el;

    const checkDeadlock = () => {
        // THE AGGRESSIVE CONDITION:
        // 1. We are trying to play (isPlayAttemptActive)
        // 2. BUT either:
        //    a) The AudioContext is NOT 'running' (it's stuck in suspended/interrupted)
        //    b) OR the HTML5 element thinks it's playing but the playhead is at 0
        const isContextStuck = audioCtx && audioCtx.state !== 'running';
        const isPlayheadStuck = !el.paused && el.currentTime === 0;

        if (isPlayAttemptActive && (isContextStuck || isPlayheadStuck)) {
            console.error("💀 [Audio Debug] DEADLOCK DETECTED: Engine Killed or Hardware Frozen.");
            window.dispatchEvent(new CustomEvent('ios-hardware-deadlock'));
            
            // Reset attempt so we don't spam the event
            isPlayAttemptActive = false; 
            clearTimeout(stallTimeout);
        }
    };

    el.addEventListener('play', () => {
        isPlayAttemptActive = true;
        clearTimeout(stallTimeout);
        
        // Check once after 1 second, then again at 3.5 seconds
        // This catches "killed" engines faster
        setTimeout(checkDeadlock, 1000); 
        stallTimeout = setTimeout(checkDeadlock, 3500);
    });

    el.addEventListener('playing', () => {
        console.log("[audio debug] play event fired");
        isPlayAttemptActive = false;
        clearTimeout(stallTimeout);
    });

    // If the playhead actually moves, we are definitely safe
    el.addEventListener('timeupdate', () => {
        if (el.currentTime > 0.1) {
            isPlayAttemptActive = false;
            clearTimeout(stallTimeout);
        }
    });

    el.addEventListener('pause', () => {
        isPlayAttemptActive = false;
        clearTimeout(stallTimeout);
    });
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
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
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
    
    // THE FIX FOR THE LOOPING BUFFER IN THE BACKGROUND
    navigator.mediaSession.setActionHandler('pause', async () => {
        handlers.pause();
        if (audioCtx && audioCtx.state === 'running') {
            await audioCtx.suspend().catch(()=>{}); 
        }
        if (silentAnchorEl) silentAnchorEl.pause();
    });

    navigator.mediaSession.setActionHandler('play', async () => {
        await unlockAudioContext();
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