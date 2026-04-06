/**
 * audio.js
 * Handles Web Audio API Context, Equalizer, and Media Session API.
 */

export let audioCtx;
export let gainNode;
let globalAudioEl = null;

let eqFilters = [];
const EQ_FREQS = [60, 250, 1000, 4000, 8000, 14000];
let isEngineInitialized = false;

/**
 * Primes the audio engine. Useful for pre-emptively resuming 
 * the context during an early user interaction.
 */
export const primeEngine = async () => {
    if (!audioCtx) initAudioEngine();
    if (audioCtx && audioCtx.state === 'suspended') {
        await audioCtx.resume();
        console.log("🔊 System Level Audio Unlocked");
    }
};

/**
 * Links the <audio> element from your Svelte component to the audio engine.
 */
export const registerAudioElement = (el) => {
    globalAudioEl = el;
};

/**
 * Crucial for iOS: Resumes the audio context within a user-triggered 
 * event (like a click) to allow sound to play.
 */
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

/**
 * Sets up the Web Audio graph: Source -> Gain -> EQ -> Destination
 */
const isIOS = () => {
  return [
    'iPad Simulator',
    'iPhone Simulator',
    'iPod Simulator',
    'iPad',
    'iPhone',
    'iPod'
  ].includes(navigator.platform)
  // iPad on iOS 13 detection
  || (navigator.userAgent.includes("Mac") && "ontouchend" in document)
};

export const initAudioEngine = () => {
    if (typeof window === 'undefined' || !globalAudioEl || isEngineInitialized) return;
    
    // Bypass Web Audio API on iOS to preserve background playback
    if (isIOS()) {
        console.warn("[Audio] iOS detected: Bypassing Web Audio API for background compatibility.");
        isEngineInitialized = true; // Prevent future attempts to initialize
        return; 
    }
    
    try {
        const AudioCtx = window.AudioContext || window['webkitAudioContext'];
        if (!AudioCtx) return;
        
        // Single instance of the context
        if (!audioCtx) audioCtx = new AudioCtx();
        
        gainNode = audioCtx.createGain();
        
        // Setup Peaking filters for the EQ
        eqFilters = EQ_FREQS.map(freq => {
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1.4;
            filter.gain.value = 0;
            return filter;
        });
        
        // Create the source from the audio element
        const source = audioCtx.createMediaElementSource(globalAudioEl);
        
        // Connect the nodes
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

/**
 * Adjusts the volume boost (gain).
 */
export const setVolumeBoost = (val) => {
    const num = parseFloat(val);
    if (!isEngineInitialized && num !== 1.0) initAudioEngine();
    if (gainNode) gainNode.gain.value = num;
};

/**
 * Adjusts a specific frequency band in the EQ.
 */
export const setEqBand = (index, val) => {
    if (!isEngineInitialized) initAudioEngine();
    if (eqFilters[index]) {
        eqFilters[index].gain.value = parseFloat(val);
    }
};

/**
 * Syncs the browser/iOS system-level "Now Playing" controls.
 */
export const updateMediaSession = (track, album, handlers) => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !window.MediaMetadata || !track) return;
    
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || 'Unknown Title',
            artist: album?.artistName || 'Unknown Artist',
            album: album?.title || 'Unknown Album',
            artwork: [
                { 
                    src: album?.coverPath 
                         ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` 
                         : '', 
                    sizes: '512x512', 
                    type: 'image/jpeg' 
                }
            ]
        });

        // Register hardware/lock-screen controls
        navigator.mediaSession.setActionHandler('play', handlers.play);
        navigator.mediaSession.setActionHandler('pause', handlers.pause);
        navigator.mediaSession.setActionHandler('previoustrack', handlers.prev);
        navigator.mediaSession.setActionHandler('nexttrack', handlers.next);
        
        // Optional: Support 10-second skip in notifications
        // navigator.mediaSession.setActionHandler('seekbackward', () => { handlers.seekRelative(-10); });
        // navigator.mediaSession.setActionHandler('seekforward', () => { handlers.seekRelative(10); });
    } catch (e) {
        console.warn("[MediaSession] Failed to update metadata:", e);
    }
};