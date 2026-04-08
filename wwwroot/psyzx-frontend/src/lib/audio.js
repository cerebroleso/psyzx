import { get } from 'svelte/store';
import { currentPlaylist, currentIndex, isShuffle, isRepeat, shuffleHistory } from '../store.js';

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
const SILENCE_B64 = "data:audio/wav;base64,UklGRiQAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

// FIX 1: Make iOS detection global so we can protect the background audio session anywhere
const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

const initSilentAnchor = () => {
    if (silentAnchorEl) return;
    silentAnchorEl = new Audio();
    silentAnchorEl.src = SILENCE_B64;
    silentAnchorEl.loop = true;
    silentAnchorEl.setAttribute("playsinline", "true");
    silentAnchorEl.volume = 0.01;
};

// FIX 3: Re-use a single AudioContext for cues so we don't exhaust iOS hardware limits
let cueCtx = null; 

export const playAudioCue = (action) => {
    // Only play cues on mobile devices
    if (window.innerWidth > 850) return;

    try {
        if (!cueCtx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            cueCtx = new AudioCtx();
        }
        
        if (cueCtx.state === 'suspended') cueCtx.resume();

        const osc = cueCtx.createOscillator();
        const gain = cueCtx.createGain();
        
        osc.connect(gain);
        gain.connect(cueCtx.destination);
        
        // Soft, fast sine wave for a premium UI "tick"
        osc.type = 'sine';
        
        if (action === 'resume') {
            osc.frequency.setValueAtTime(300, cueCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(600, cueCtx.currentTime + 0.05);
        } else {
            osc.frequency.setValueAtTime(600, cueCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(300, cueCtx.currentTime + 0.05);
        }
        
        gain.gain.setValueAtTime(0.05, cueCtx.currentTime); 
        gain.gain.exponentialRampToValueAtTime(0.001, cueCtx.currentTime + 0.05);
        
        osc.start(cueCtx.currentTime);
        osc.stop(cueCtx.currentTime + 0.05);
    } catch(e) {
        console.error("Audio cue failed:", e);
    }
};

export const initAudioEngine = async () => {
    if (typeof window === 'undefined' || !globalAudioEl || isEngineInitialized || isInitializing) return;
    isInitializing = true; 

    if (isIOS) {
        console.log("iOS detected: Bypassing AudioContext to preserve background audio");
        isInitializing = false;
        return; 
    }

    try {
        const AudioCtx = window.AudioContext || window['webkitAudioContext'];
        if (!audioCtx) audioCtx = new AudioCtx();

        audioCtx.onstatechange = () => {
            console.log(`[Audio Engine] Hardware state changed to: ${audioCtx.state}`);
            
            // If the system suspended us unexpectedly, aggressively try to recover
            if (audioCtx.state === 'interrupted' || audioCtx.state === 'suspended') {
                // Only try to recover if the HTML5 audio element actually wants to play
                if (globalAudioEl && !globalAudioEl.paused) {
                    audioCtx.resume().catch(e => console.error("Recovery failed:", e));
                }
            }
        };
        
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
            if (audioCtx && (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted')) {
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
    if (!isEngineInitialized && !isIOS) await initAudioEngine();
    if (audioCtx?.state === 'suspended') {
        resumePromise = audioCtx.resume().catch(() => {});
    }
};

export const unlockAudioContext = () => { 
    // FIX 1: Absolutely forbid creating an AudioContext here on iOS 
    if (isIOS) return;

    if (!audioCtx) {
        const AudioCtx = window.AudioContext || window['webkitAudioContext'];
        audioCtx = new AudioCtx();
    }

    isPlayAttemptActive = true;

    if (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted') {
        resumePromise = audioCtx.resume().catch(() => {
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
        const isContextStuck = audioCtx && audioCtx.state !== 'running';
        const isPlayheadStuck = !el.paused && el.currentTime === 0;

        if (isPlayAttemptActive && (isContextStuck || isPlayheadStuck)) {
            console.error("💀 [Audio Debug] DEADLOCK DETECTED: Engine Killed or Hardware Frozen.");
            window.dispatchEvent(new CustomEvent('ios-hardware-deadlock'));
            
            isPlayAttemptActive = false; 
            clearTimeout(stallTimeout);
        }
    };

    el.addEventListener('play', () => {
        isPlayAttemptActive = true;
        clearTimeout(stallTimeout);
        
        // FIX: Pre-warm the cue context on the first user interaction 
        // to prevent a CPU spike/buffer underrun when the user presses play.
        if (!cueCtx && window.innerWidth <= 850) {
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                cueCtx = new AudioCtx();
            } catch(e) {}
        }

        if (!isEngineInitialized && !isIOS) {
            unlockAudioContext();
            initAudioEngine();
        }

        setTimeout(checkDeadlock, 1000); 
        stallTimeout = setTimeout(checkDeadlock, 3500);
    });

    el.addEventListener('playing', () => {
        isPlayAttemptActive = false;
        clearTimeout(stallTimeout);
    });

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
        gainNode.gain.value = num;
    }
};

export const setEqBand = (index, val) => {
    const num = parseFloat(val);
    pendingEq[index] = num;
    if (eqFilters[index] && audioCtx) {
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
        eqFilters[index].gain.value = num;
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
    
    navigator.mediaSession.setActionHandler('pause', async () => {
        handlers.pause();
        // FIX 2: Do NOT suspend audioCtx here. It causes the 8-bit glitch.
        if (silentAnchorEl) silentAnchorEl.pause();
    });

    navigator.mediaSession.setActionHandler('play', async () => {
        if (!isIOS) await unlockAudioContext();
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

// -------------------------------------------------------------------------
// GLOBAL PLAYBACK CONTROLLERS
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------
// GLOBAL PLAYBACK CONTROLLERS
// -------------------------------------------------------------------------

export const togglePlayGlobal = () => { 
    if (!globalAudioEl) return;
    
    if (!isIOS) {
        unlockAudioContext();
        if (!isEngineInitialized) initAudioEngine();
    }

    if (globalAudioEl.paused) { 
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        
        // 1. Start the music immediately
        globalAudioEl.play().catch(e => console.error("Playback blocked:", e)); 
        
        // 2. FIX: Delay the Web Audio API cue by 80ms.
        // This gives iOS CoreAudio time to lock the hardware to the HTML5 stream
        // preventing the 1ms underrun/stutter collision.
        setTimeout(() => {
            playAudioCue('resume');
        }, 80);

    } else { 
        // Pausing doesn't suffer from ducking, so we can fire both immediately
        globalAudioEl.pause(); 
        playAudioCue('pause');
    } 
};

export const playNextGlobal = async (api) => {
    if (!isIOS) {
        unlockAudioContext();
        if (!isEngineInitialized) initAudioEngine();
    }

    const playlist = get(currentPlaylist);
    const index = get(currentIndex);
    const shuffle = get(isShuffle);
    const repeat = get(isRepeat);
    const history = get(shuffleHistory);

    if (playlist.length === 0) return;

    if (!repeat && index === playlist.length - 1) {
        const seedTrackId = playlist[index].id;
        const excludeIds = playlist.map(t => t.id);
        
        const newTracks = await api.getRadioMix(seedTrackId, excludeIds);
        
        if (newTracks.length > 0) {
            currentPlaylist.update(list => [...list, ...newTracks]);
        } else {
            if (globalAudioEl) globalAudioEl.pause();
            return;
        }
    }

    if (shuffle) {
        const updatedHistory = [...history, index];
        shuffleHistory.set(updatedHistory);

        const recentLimit = Math.floor(playlist.length / 2);
        const recentlyPlayed = updatedHistory.slice(-recentLimit);

        let unplayed = Array.from({length: playlist.length}, (_, i) => i)
            .filter(i => !recentlyPlayed.includes(i) && i !== index);
        
        if (unplayed.length === 0) {
            shuffleHistory.set([]); 
            unplayed = Array.from({length: playlist.length}, (_, i) => i).filter(i => i !== index);
        }
        
        currentIndex.set(unplayed[Math.floor(Math.random() * unplayed.length)]);
    } else {
        currentIndex.set((index + 1) % playlist.length);
    }
};

export const playPrevGlobal = () => {
    if (!isIOS) {
        unlockAudioContext();
        if (!isEngineInitialized) initAudioEngine();
    }

    const playlist = get(currentPlaylist);
    const index = get(currentIndex);
    const shuffle = get(isShuffle);
    const history = get(shuffleHistory);

    if (!globalAudioEl || playlist.length === 0) return;

    if (globalAudioEl.currentTime > 3) {
        globalAudioEl.currentTime = 0;
    } else if (shuffle && history.length > 0) {
        const prevIndex = history.pop();
        shuffleHistory.set(history);
        currentIndex.set(prevIndex);
    } else {
        currentIndex.set((index - 1 + playlist.length) % playlist.length);
    }
};