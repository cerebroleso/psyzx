import { get } from 'svelte/store';
import {
    currentPlaylist,
    currentIndex,
    isShuffle,
    isRepeat,
    shuffleHistory,
    isPlaying,
    isBuffering,
    playerCurrentTime,
    playerDuration
} from '../store.js';

const MAX_CACHE_SIZE = 5;

export let audioCtx;
export let gainNode;
let eqFilters = [];
let mixerNode = null;
let heartbeatOsc = null;

export let playerA = null;
export let playerB = null;
let html5ActivePlayer = null;
let html5StandbyPlayer = null;

let gainA = null;
let gainB = null;

let currentBuffer = null;
let nextBuffer = null;
let currentSource = null;
let trackStartTime = 0;
let pauseOffset = 0;
let currentTrackUrl = null;
let nextTrackUrl = null;

// synthetic clock survives backgrounding better than raf
let syntheticClockInterval = null;

const decodeCache = new Map();

export let isEngineInitialized = false;
let hasDoneSilentPrime = false;
let stallTimeout = null;

// dedicated dom-attached silent player for ios keep-alive (WebAudio mode only)
let silentPlayer = null;

let scrubOsc = null;
let scrubGain = null;

const savedGapless = typeof window !== 'undefined' ? localStorage.getItem('psyzx_webaudio_gapless') : null;
export let isWebAudioMode = savedGapless === null ? true : savedGapless === 'true';

export const setWebAudioGaplessMode = (enabled) => {
    isWebAudioMode = enabled;
    if (typeof window !== 'undefined') {
        localStorage.setItem('psyzx_webaudio_gapless', enabled.toString());
        window.location.reload();
    }
};

let pendingBoost = 1.0;
let pendingEq = [0, 0, 0, 0, 0, 0];
const EQ_FREQS = [60, 250, 1000, 4000, 8000, 14000];

const SILENCE_B64 =
    'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjEyLjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIAD+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+AAAAAExhdmM1OC4xMzQAAAAAAAAAAAAAAAAkAAAAAAAAAAABIADZt9snAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFNRTMuMTAwA8EAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//MUZAMAAAGkAAAAAAAAA0gAAAAATEFNRTMuMTAwA8EAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export const activePlayer = {
    get currentTime() {
        return isWebAudioMode
            ? get(playerCurrentTime)
            : (html5ActivePlayer ? html5ActivePlayer.currentTime : 0);
    },
    set currentTime(time) {
        if (isWebAudioMode) {
            seekWebAudio(time);
        } else if (html5ActivePlayer) {
            try {
                if (html5ActivePlayer.fastSeek) html5ActivePlayer.fastSeek(time);
                else html5ActivePlayer.currentTime = time;
            } catch(e) {}
        }
    },
    get duration() {
        return isWebAudioMode
            ? get(playerDuration)
            : (html5ActivePlayer ? html5ActivePlayer.duration : 0);
    },
    get paused() {
        return !get(isPlaying);
    },
    play: async () => {
        if (isWebAudioMode) {
            return playWebAudio();
        } else if (html5ActivePlayer) {
            return html5ActivePlayer.play();
        }
    },
    pause: () => {
        if (isWebAudioMode) {
            pauseWebAudio();
        } else if (html5ActivePlayer) {
            html5ActivePlayer.pause();
        }
    },
    load: () => {
        if (!isWebAudioMode && html5ActivePlayer) html5ActivePlayer.load();
    },
    get src() {
        return isWebAudioMode
            ? currentTrackUrl
            : (html5ActivePlayer ? html5ActivePlayer.src : '');
    },
    set src(val) {
        if (!isWebAudioMode && html5ActivePlayer) html5ActivePlayer.src = val;
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SILENT PLAYER
// ─────────────────────────────────────────────────────────────────────────────
const initSilentPlayer = () => {
    if (typeof document === 'undefined' || silentPlayer) return;

    silentPlayer = document.createElement('audio');
    silentPlayer.src = SILENCE_B64;
    silentPlayer.loop = true;
    silentPlayer.volume = 0.0001;
    silentPlayer.preload = 'auto';
    silentPlayer.autoplay = false;
    silentPlayer.playsInline = true;
    silentPlayer.setAttribute('playsinline', '');
    silentPlayer.setAttribute('webkit-playsinline', '');
    silentPlayer.setAttribute('aria-hidden', 'true');
    silentPlayer.setAttribute('x-webkit-airplay', 'allow');
    silentPlayer.setAttribute('controls', 'false');

    silentPlayer.style.cssText = `
        position: fixed;
        left: -9999px;
        top: -9999px;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
    `;

    document.body.appendChild(silentPlayer);
};

const startSilentKeepAlive = () => {
    initSilentPlayer();
    if (!silentPlayer) return;

    try {
        silentPlayer.loop = true;
        silentPlayer.volume = 0.0001;
        const p = silentPlayer.play();
        if (p !== undefined) p.catch(() => {});
    } catch {}
};

const stopSilentKeepAlive = () => {
    if (!silentPlayer) return;
    try {
        silentPlayer.pause();
        silentPlayer.currentTime = 0;
    } catch {}
};

// ─────────────────────────────────────────────────────────────────────────────
// WEB AUDIO GRAPH
// ─────────────────────────────────────────────────────────────────────────────
const buildWebAudioGraph = () => {
    if (!audioCtx) return;

    if (!mixerNode) {
        mixerNode = audioCtx.createGain();
        mixerNode.gain.value = 1.0;
    }

    // Connect MediaElementSources universally so the HTML5 player can act as
    // an iOS widget driver in Web Audio Mode without blasting at 1.0 volume.
    try {
        if (!gainA) {
            const sourceA = audioCtx.createMediaElementSource(playerA);
            const sourceB = audioCtx.createMediaElementSource(playerB);

            gainA = audioCtx.createGain();
            gainB = audioCtx.createGain();

            sourceA.connect(gainA);
            sourceB.connect(gainB);

            gainA.connect(mixerNode);
            gainB.connect(mixerNode);
        }
    } catch (e) {}

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
        eqFilters[i].connect(eqFilters[i + 1]);
    }
    eqFilters[eqFilters.length - 1].connect(gainNode);
    gainNode.connect(audioCtx.destination);
};

const fetchAndDecode = async (url) => {
    if (decodeCache.has(url)) return await decodeCache.get(url);

    // Enforce memory limit
    if (decodeCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = decodeCache.keys().next().value;
        decodeCache.delete(oldestKey);
    }
    
    const p = (async () => {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('fetch failed');
            const arrayBuffer = await response.arrayBuffer();

            return new Promise((resolve, reject) => {
                audioCtx.decodeAudioData(
                    arrayBuffer,
                    (buffer) => resolve(buffer),
                    (err) => reject(err)
                );
            });
        } catch (e) {
            return null;
        }
    })();

    decodeCache.set(url, p);
    return p;
};

const startSyntheticClock = () => {
    if (syntheticClockInterval) clearInterval(syntheticClockInterval);
    let earlyEndFired = false;

    syntheticClockInterval = setInterval(() => {
        if (get(isPlaying) && currentBuffer && audioCtx) {
            const currentRealTime = audioCtx.currentTime - trackStartTime + pauseOffset;
            playerCurrentTime.set(currentRealTime);

            if (isWebAudioMode) {
                if (currentBuffer.duration - currentRealTime <= 0.15 && !earlyEndFired) {
                    earlyEndFired = true;
                    window.dispatchEvent(new CustomEvent('track-ended'));
                }
            } else if (currentRealTime >= currentBuffer.duration - 0.05 && !earlyEndFired) {
                earlyEndFired = true;
                window.dispatchEvent(new CustomEvent('track-ended'));
            }
        }
    }, 100);
};

// ─────────────────────────────────────────────────────────────────────────────
// WebAudio playback primitives
// ─────────────────────────────────────────────────────────────────────────────
const playWebAudio = () => {
    if (!currentBuffer || !audioCtx) return;

    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }

    startSilentKeepAlive();

    // Dynamically hold lock screen scrubber active natively
    if (html5ActivePlayer && html5ActivePlayer.paused) {
        const p = html5ActivePlayer.play();
        if (p !== undefined) p.catch(() => {});
    }

    if (currentSource) {
        try { currentSource.stop(); } catch {}
        try { currentSource.disconnect(); } catch {}
        currentSource = null;
    }

    currentSource = audioCtx.createBufferSource();
    currentSource.buffer = currentBuffer;
    currentSource.connect(mixerNode);

    trackStartTime = audioCtx.currentTime;
    currentSource.start(0, pauseOffset);

    isPlaying.set(true);
    startSyntheticClock();

    updateMediaPositionState(pauseOffset, currentBuffer.duration);
};

const pauseWebAudio = () => {
    if (!currentSource || !audioCtx) return;

    try { currentSource.stop(); } catch {}
    try { currentSource.disconnect(); } catch {}
    currentSource = null;

    pauseOffset += (audioCtx.currentTime - trackStartTime);

    if (html5ActivePlayer && !html5ActivePlayer.paused) {
        html5ActivePlayer.pause();
    }

    if (!get(isPlaying)) stopSilentKeepAlive();

    isPlaying.set(false);
    if (syntheticClockInterval) clearInterval(syntheticClockInterval);

    if (currentBuffer) updateMediaPositionState(pauseOffset, currentBuffer.duration);
};

const stopWebAudio = () => {
    if (currentSource) {
        try { currentSource.stop(); } catch {}
        try { currentSource.disconnect(); } catch {}
        currentSource = null;
    }
    pauseOffset = 0;
    if (syntheticClockInterval) clearInterval(syntheticClockInterval);
};

const seekWebAudio = (time) => {
    if (!currentBuffer || !audioCtx) return;

    const wasPlaying = get(isPlaying);
    stopWebAudio();

    pauseOffset = Math.max(0, Math.min(time, currentBuffer.duration));
    playerCurrentTime.set(pauseOffset);

    if (html5ActivePlayer) {
        try { html5ActivePlayer.currentTime = pauseOffset; } catch(e) {}
    }

    if (wasPlaying) {
        playWebAudio();
    } else {
        updateMediaPositionState(pauseOffset, currentBuffer.duration);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// UNLOCK / INIT
// ─────────────────────────────────────────────────────────────────────────────
export const unlockAudioContext = () => {
    if (hasDoneSilentPrime) return;

    const AudioCtx = window.AudioContext || window['webkitAudioContext'];
    if (!audioCtx) audioCtx = new AudioCtx();

    initSilentPlayer();

    audioCtx.onstatechange = () => {
        if ((audioCtx.state === 'interrupted' || audioCtx.state === 'suspended') && get(isPlaying)) {
            audioCtx.resume().catch(() => {});
        } else if (audioCtx.state === 'running' && get(isPlaying)) {
            if (html5ActivePlayer && html5ActivePlayer.paused) {
                const p = html5ActivePlayer.play();
                if (p !== undefined) p.catch(() => {});
            }
        }
    };

    buildWebAudioGraph();

    if (playerA && playerB) {
        playerA.src = SILENCE_B64;
        playerB.src = SILENCE_B64;

        const pA = playerA.play();
        if (pA !== undefined) pA.catch(() => {});

        const pB = playerB.play();
        if (pB !== undefined) pB.catch(() => {});

        playerA.pause();
        playerB.pause();
    }

    if (isWebAudioMode) {
        if (silentPlayer) {
            silentPlayer.volume = 0.0001;
            silentPlayer.loop = true;

            const p = silentPlayer.play();
            if (p !== undefined) {
                p.then(() => {
                    if (!get(isPlaying)) silentPlayer.pause();
                }).catch(() => {});
            }
        }

        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
    }

    hasDoneSilentPrime = true;
    isEngineInitialized = true;
};

export const registerAudioElements = (elA, elB) => {
    playerA = elA;
    playerB = elB;
    html5ActivePlayer = playerA;
    html5StandbyPlayer = playerB;

    if (!isWebAudioMode) {
        const setupListeners = (el) => {
            el.addEventListener('loadedmetadata', () => {
                if (el === html5ActivePlayer) {
                    playerDuration.set(el.duration);
                    updateMediaPositionState(el.currentTime, el.duration);
                }
            });

            el.addEventListener('timeupdate', () => {
                if (el === html5ActivePlayer && el.duration > 0) {
                    playerCurrentTime.set(el.currentTime);
                    if (el.duration - el.currentTime <= 0.15 && !el._earlyEndFired) {
                        el._earlyEndFired = true;
                        window.dispatchEvent(new CustomEvent('track-ended'));
                    }
                }
            });

            el.addEventListener('play', () => {
                el._earlyEndFired = false;
                clearTimeout(stallTimeout);
                stallTimeout = setTimeout(() => checkDeadlock(el), 3500);
                if (el === html5ActivePlayer) isPlaying.set(true);
            });

            el.addEventListener('waiting', () => {
                if (el === html5ActivePlayer) isBuffering.set(true);
            });

            el.addEventListener('playing', () => {
                if (el === html5ActivePlayer) {
                    isBuffering.set(false);
                    isPlaying.set(true);
                }
                clearTimeout(stallTimeout);
            });

            el.addEventListener('pause', () => {
                if (el === html5ActivePlayer) isPlaying.set(false);
                clearTimeout(stallTimeout);
            });
        };

        setupListeners(playerA);
        setupListeners(playerB);
    }
};

const checkDeadlock = (el) => {
    const isContextStuck = audioCtx && audioCtx.state !== 'running';
    const isPlayheadStuck = !el.paused && el.currentTime === 0;

    if (isContextStuck || isPlayheadStuck) {
        window.dispatchEvent(new CustomEvent('ios-hardware-deadlock'));
        clearTimeout(stallTimeout);
    }
};

export const preloadNextUrl = async (url) => {
    if (isWebAudioMode) {
        if (url === currentTrackUrl) return;
        await fetchAndDecode(url);
    } else {
        const targetPlayer = html5StandbyPlayer;
        if (targetPlayer && !targetPlayer.src.includes(url)) {
            targetPlayer.src = url;
            targetPlayer.preload = 'auto';

            const targetGain = targetPlayer === playerA ? gainA : gainB;
            if (targetGain && audioCtx) {
                targetGain.gain.cancelScheduledValues(audioCtx.currentTime);
                targetGain.gain.value = 0;
            }

            targetPlayer.load();

            const p = targetPlayer.play();
            if (p !== undefined) {
                p.then(() => {
                    setTimeout(() => {
                        targetPlayer.pause();
                        targetPlayer.currentTime = 0;
                    }, 50);
                }).catch(() => {});
            }
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// LOAD AND PLAY
// ─────────────────────────────────────────────────────────────────────────────
export const loadAndPlayUrl = async (url) => {
    if (!isEngineInitialized) unlockAudioContext();

    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (isWebAudioMode) startSilentKeepAlive();

    // Universal Setup - ALWAYS fetch real track metadata natively to feed iOS System UI
    const oldPlayer = html5ActivePlayer;
    html5ActivePlayer = html5StandbyPlayer;
    html5StandbyPlayer = oldPlayer;

    const activeTargetGain = html5ActivePlayer === playerA ? gainA : gainB;
    const oldTargetGain = html5StandbyPlayer === playerA ? gainA : gainB;

    if (!html5ActivePlayer.src.includes(url)) {
        html5ActivePlayer.src = url;
        html5ActivePlayer.load();
    }
    html5ActivePlayer.currentTime = 0;

    try {
        const playPromise = html5ActivePlayer.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                if (audioCtx && oldTargetGain) {
                    oldTargetGain.gain.cancelScheduledValues(audioCtx.currentTime);
                    oldTargetGain.gain.setValueAtTime(oldTargetGain.gain.value, audioCtx.currentTime);
                    oldTargetGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15);
                }
                setTimeout(() => {
                    html5StandbyPlayer.pause();
                }, 200);
            }).catch(() => {
                if (!isWebAudioMode) isPlaying.set(false);
            });
        }

        if (audioCtx && activeTargetGain) {
            activeTargetGain.gain.cancelScheduledValues(audioCtx.currentTime);
            activeTargetGain.gain.setValueAtTime(0, audioCtx.currentTime);
            // If Web Audio Mode, keep native player effectively muted so it acts as iOS widget driver
            const targetVol = isWebAudioMode ? 0.0001 : 1;
            activeTargetGain.gain.linearRampToValueAtTime(targetVol, audioCtx.currentTime + 0.05);
        }

        if (!isWebAudioMode) isPlaying.set(true);
    } catch (e) {
        if (!isWebAudioMode) isPlaying.set(false);
    }

    if (isWebAudioMode) {
        const isNaturalRollover =
            currentBuffer && ((currentBuffer.duration - get(playerCurrentTime)) <= 0.3);

        if (isNaturalRollover) {
            currentSource = null;
        } else {
            stopWebAudio();
        }

        isBuffering.set(true);
        isPlaying.set(false);

        currentBuffer = await fetchAndDecode(url);
        currentTrackUrl = url;

        if (!currentBuffer) {
            isBuffering.set(false);
            html5ActivePlayer.pause();
            if (!get(isPlaying)) stopSilentKeepAlive();
            return;
        }

        playerDuration.set(currentBuffer.duration);
        pauseOffset = 0;

        // Lock native player back to 0 perfectly inline with Gapless source
        html5ActivePlayer.currentTime = 0;

        playWebAudio(); // synchronous
        isBuffering.set(false);
    }
};

export const togglePlayGlobal = () => {
    if (!isEngineInitialized) unlockAudioContext();

    if (isWebAudioMode) {
        if (get(isPlaying)) {
            pauseWebAudio();
        } else {
            void playWebAudio();
        }
    } else {
        if (!html5ActivePlayer) return;

        if (html5ActivePlayer.paused) {
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

            const activeTargetGain = html5ActivePlayer === playerA ? gainA : gainB;
            if (activeTargetGain && audioCtx) {
                activeTargetGain.gain.cancelScheduledValues(audioCtx.currentTime);
                activeTargetGain.gain.value = 1;
            }

            const playPromise = html5ActivePlayer.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {});
            }

            isPlaying.set(true);
        } else {
            html5ActivePlayer.pause();
            isPlaying.set(false);
        }
    }
};

export const setVolumeBoost = (val) => {
    pendingBoost = parseFloat(val);
    if (gainNode && audioCtx) gainNode.gain.value = pendingBoost;
};

export const setEqBand = (index, val) => {
    pendingEq[index] = parseFloat(val);
    if (eqFilters[index] && audioCtx) {
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        eqFilters[index].gain.value = pendingEq[index];
    }
};

export const updateMediaSession = (track, album, handlers) => {
    if (!track || !('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: album?.artistName,
        album: album?.title,
        artwork: [
            {
                src: album?.coverPath
                    ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&size=thumb`
                    : '',
                sizes: '512x512',
                type: 'image/jpeg'
            }
        ]
    });

    navigator.mediaSession.setActionHandler('pause', async () => {
        handlers.pause();
    });

    navigator.mediaSession.setActionHandler('play', async () => {
        if (audioCtx?.state === 'suspended') await audioCtx.resume();
        handlers.play();
    });

    if (handlers.seek) {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            const seekTime = details.seekTime || 0;
            
            // 1. Physically Force OS Scrubber Acknowledgement FIRST
            activePlayer.currentTime = seekTime;
            
            const dur = activePlayer.duration;
            if (!isNaN(dur) && dur > 0) {
                updateMediaPositionState(seekTime, dur);
            }

            // 2. Resolve Svelte App UI state
            if (handlers.seek) handlers.seek(seekTime);
        });
    }

    navigator.mediaSession.setActionHandler('previoustrack', handlers.prev);
    navigator.mediaSession.setActionHandler('nexttrack', handlers.next);
};

export const updateMediaPositionState = (currentTime, duration) => {
    if ('mediaSession' in navigator && !isNaN(duration) && duration > 0) {
        try {
            const safePosition = Math.max(0, Math.min(currentTime, duration));
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: get(isPlaying) ? 1.0 : 0.0,
                position: safePosition
            });
        } catch (e) {}
    }
};

export const playSkipCue = (dir) => {
    if (!audioCtx || !isWebAudioMode) return;
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        
        const now = audioCtx.currentTime;
        
        if (dir === 'next') {
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
        } else {
            // prev
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
        }
        
        gain.gain.setValueAtTime(0.75, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        
        osc.start(now);
        osc.stop(now + 0.1);
    } catch(e) {}
};

let lastNextTime = 0;

export const playNextGlobal = async (api, forceManualCue = false) => {
    const now = Date.now();
    if (now - lastNextTime < 500) return;
    lastNextTime = now;

    const playlist = get(currentPlaylist);
    const index = get(currentIndex);
    const shuffle = get(isShuffle);
    const repeat = get(isRepeat);
    const history = get(shuffleHistory);

    if (playlist.length === 0) return;

    // Detect if this is an automatic rollover by checking if the track is within 0.5s of ending
    const currentTime = get(playerCurrentTime);
    const duration = get(playerDuration);
    const isAutoAdvance = duration > 0 && (duration - currentTime <= 0.5);

    if (isWebAudioMode && (!isAutoAdvance || forceManualCue)) {
        playSkipCue('next');
    }

    if (!repeat && index === playlist.length - 1) {
        const seedTrackId = playlist[index].id;
        const excludeIds = playlist.map(t => t.id);

        const newTracks = await api.getRadioMix(seedTrackId, excludeIds);

        if (newTracks.length > 0) {
            currentPlaylist.update(list => [...list, ...newTracks]);
        } else {
            if (isWebAudioMode) pauseWebAudio();
            else if (html5ActivePlayer) html5ActivePlayer.pause();
            return;
        }
    }

    if (shuffle) {
        const updatedHistory = [...history, index];
        shuffleHistory.set(updatedHistory);

        const recentLimit = Math.floor(playlist.length / 2);
        const recentlyPlayed = updatedHistory.slice(-recentLimit);

        let unplayed = Array.from({ length: playlist.length }, (_, i) => i)
            .filter(i => !recentlyPlayed.includes(i) && i !== index);

        if (unplayed.length === 0) {
            shuffleHistory.set([]);
            unplayed = Array.from({ length: playlist.length }, (_, i) => i).filter(i => i !== index);
        }

        currentIndex.set(unplayed[Math.floor(Math.random() * unplayed.length)]);
    } else {
        currentIndex.set((index + 1) % playlist.length);
    }
};

export const playPrevGlobal = () => {
    const playlist = get(currentPlaylist);
    const index = get(currentIndex);
    const shuffle = get(isShuffle);
    const history = get(shuffleHistory);

    if (playlist.length === 0) return;

    const currentPos = isWebAudioMode
        ? pauseOffset
        : (html5ActivePlayer ? html5ActivePlayer.currentTime : 0);

    if (currentPos > 3) {
        if (isWebAudioMode) seekWebAudio(0);
        else if (html5ActivePlayer) html5ActivePlayer.currentTime = 0;
    } else {
        if (isWebAudioMode) playSkipCue('prev');
        
        if (shuffle && history.length > 0) {
            const prevIndex = history.pop();
            shuffleHistory.set(history);
            currentIndex.set(prevIndex);
        } else {
            currentIndex.set((index - 1 + playlist.length) % playlist.length);
        }
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// SCRUB SFX
// ─────────────────────────────────────────────────────────────────────────────
export const startScrubEffect = () => {
    if (!audioCtx || !isWebAudioMode) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    const soundType = typeof window !== 'undefined'
        ? localStorage.getItem('psyzx_scrub_sound') || 'speed'
        : 'speed';

    if (soundType === 'none' || soundType === 'vinyl') return;

    scrubGain = audioCtx.createGain();
    scrubGain.connect(mixerNode);
    scrubGain.gain.value = 0;

    scrubOsc = audioCtx.createOscillator();
    scrubOsc.type = soundType === 'beep' ? 'square' : 'triangle';
    scrubOsc.connect(scrubGain);
    scrubOsc.start();
};

export const updateScrubEffect = (speed, dir) => {
    if (!isWebAudioMode || !audioCtx) return;

    const soundType = typeof window !== 'undefined'
        ? localStorage.getItem('psyzx_scrub_sound') || 'speed'
        : 'speed';

    if (soundType === 'none') return;

    if (soundType === 'vinyl') {
        if (currentSource && currentSource.playbackRate) {
            const warpRate = dir > 0
                ? Math.min(2.5, 1.0 + (speed * 4.0))
                : Math.max(0.2, 1.0 - (speed * 3.0));
            currentSource.playbackRate.cancelScheduledValues(audioCtx.currentTime);
            currentSource.playbackRate.setTargetAtTime(warpRate, audioCtx.currentTime, 0.01);
        }
        return;
    }

    if (!scrubGain || !scrubOsc) return;

    const targetGain = Math.min(0.4, speed * 1.5);
    scrubGain.gain.cancelScheduledValues(audioCtx.currentTime);
    scrubGain.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.02);

    if (soundType === 'speed' && scrubOsc.frequency) {
        const targetFreq = 100 + (speed * 4000) * (dir > 0 ? 1 : 0.8);
        scrubOsc.frequency.cancelScheduledValues(audioCtx.currentTime);
        scrubOsc.frequency.setTargetAtTime(
            Math.max(100, Math.min(5000, targetFreq)),
            audioCtx.currentTime, 0.02
        );
    } else if (soundType === 'beep' && scrubOsc.frequency) {
        const targetFreq = dir > 0 ? 800 : 600;
        scrubOsc.frequency.cancelScheduledValues(audioCtx.currentTime);
        scrubOsc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.01);
        scrubGain.gain.setTargetAtTime(
            (Date.now() % 100 < 50) ? targetGain : 0,
            audioCtx.currentTime, 0.01
        );
    }
};

export const stopScrubEffect = () => {
    if (!audioCtx) return;

    if (currentSource && currentSource.playbackRate) {
        currentSource.playbackRate.cancelScheduledValues(audioCtx.currentTime);
        currentSource.playbackRate.value = 1.0;
    }

    if (scrubGain) {
        scrubGain.gain.cancelScheduledValues(audioCtx.currentTime);
        scrubGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.01);
        setTimeout(() => {
            if (scrubOsc) { try { scrubOsc.stop(); } catch(e) {} }
            if (scrubGain) { try { scrubGain.disconnect(); } catch(e) {} }
            scrubOsc = null;
            scrubGain = null;
        }, 50);
    }
};