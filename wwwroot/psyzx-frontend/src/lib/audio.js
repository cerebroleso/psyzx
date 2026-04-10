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

let syntheticClockInterval = null;
const decodeCache = new Map();

export let isEngineInitialized = false;
let hasDoneSilentPrime = false;
let stallTimeout = null;

export let isWebAudioMode =
    typeof window !== 'undefined'
        ? localStorage.getItem('psyzx_webaudio_gapless') === 'true'
        : false;

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
            playWebAudio();
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

export const playAudioCue = (action, delaySeconds = 0) => {
    if (typeof window !== 'undefined' && window.innerWidth > 850 || !audioCtx) return;
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';

        const startTime = audioCtx.currentTime + delaySeconds;

        if (action === 'resume') {
            osc.frequency.setValueAtTime(300, startTime);
            osc.frequency.exponentialRampToValueAtTime(600, startTime + 0.05);
        } else {
            osc.frequency.setValueAtTime(600, startTime);
            osc.frequency.exponentialRampToValueAtTime(300, startTime + 0.05);
        }

        gain.gain.setValueAtTime(0.05, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.05);

        osc.start(startTime);
        osc.stop(startTime + 0.05);
    } catch(e) {}
};

const buildWebAudioGraph = () => {
    if (!audioCtx) return;

    if (!mixerNode) {
        mixerNode = audioCtx.createGain();
        mixerNode.gain.value = 1.0;
    }

    try {
        const sourceA = audioCtx.createMediaElementSource(playerA);
        const sourceB = audioCtx.createMediaElementSource(playerB);
        gainA = audioCtx.createGain();
        gainB = audioCtx.createGain();

        sourceA.connect(gainA);
        sourceB.connect(gainB);
        gainA.connect(mixerNode);
        gainB.connect(mixerNode);
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
                if (currentBuffer.duration - currentRealTime <= 0.25 && !earlyEndFired) {
                    earlyEndFired = true;
                    window.dispatchEvent(new CustomEvent('track-ended'));
                }
            }
        }
    }, 100);
};

const playWebAudio = () => {
    if (!currentBuffer || !audioCtx) return;

    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    // WebAudio Mode uses html5ActivePlayer dynamically to hold lock screen scrubber active
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

    isPlaying.set(false);
    playAudioCue('pause');
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
        playAudioCue('resume', 0.08);
    } else {
        updateMediaPositionState(pauseOffset, currentBuffer.duration);
    }
};

export const unlockAudioContext = () => {
    if (hasDoneSilentPrime) return;

    const AudioCtx = window.AudioContext || window['webkitAudioContext'];
    if (!audioCtx) audioCtx = new AudioCtx();

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
        const pA = playerA.play(); if (pA !== undefined) pA.catch(() => {});
        const pB = playerB.play(); if (pB !== undefined) pB.catch(() => {});
        playerA.pause();
        playerB.pause();
    }

    if (isWebAudioMode && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
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
            if (targetGain && audioCtx && !isWebAudioMode) {
                targetGain.gain.cancelScheduledValues(audioCtx.currentTime);
                targetGain.gain.value = 0;
            }

            targetPlayer.load();

            const p = targetPlayer.play();
            if (p !== undefined) {
                p.then(() => {
                    targetPlayer.pause();
                    targetPlayer.currentTime = 0;
                }).catch(() => {});
            }
        }
    }
};

export const loadAndPlayUrl = async (url) => {
    if (!isEngineInitialized) unlockAudioContext();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    // Universal Setup - ALWAYS fetch real track metadata natively to feed iOS System UI
    const oldPlayer = html5ActivePlayer;
    html5ActivePlayer = html5StandbyPlayer;
    html5StandbyPlayer = oldPlayer;

    const activeTargetGain = html5ActivePlayer === playerA ? gainA : gainB;
    const oldTargetGain = html5StandbyPlayer === playerA ? gainA : gainB;

    if (audioCtx) {
        if (oldTargetGain && !html5StandbyPlayer.paused) {
            oldTargetGain.gain.cancelScheduledValues(audioCtx.currentTime);
            oldTargetGain.gain.setValueAtTime(oldTargetGain.gain.value, audioCtx.currentTime);
            oldTargetGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);

            setTimeout(() => {
                html5StandbyPlayer.pause();
            }, 250);
        } else {
            html5StandbyPlayer.pause();
        }

        if (activeTargetGain) {
            activeTargetGain.gain.cancelScheduledValues(audioCtx.currentTime);
            activeTargetGain.gain.setValueAtTime(0, audioCtx.currentTime);

            // If Web Audio, keep native player effectively muted so it only acts as an iOS widget driver
            const targetVol = isWebAudioMode ? 0.0001 : 1;
            activeTargetGain.gain.linearRampToValueAtTime(targetVol, audioCtx.currentTime + 0.05);
        }
    } else {
        html5StandbyPlayer.pause();
    }

    if (!html5ActivePlayer.src.includes(url)) {
        html5ActivePlayer.src = url;
        html5ActivePlayer.load();
        html5ActivePlayer.currentTime = 0;
    } else if (html5ActivePlayer.currentTime > 0.5) {
        html5ActivePlayer.currentTime = 0;
    }

    try {
        const playPromise = html5ActivePlayer.play();
        if (playPromise !== undefined) playPromise.catch(() => {});
    } catch (e) {}

    // Divergent processing based on mode
    if (isWebAudioMode) {
        const isNaturalRollover = currentBuffer && ((currentBuffer.duration - get(playerCurrentTime)) <= 0.3);

        if (isNaturalRollover) {
            currentSource = null;
        } else {
            stopWebAudio();
        }

        isBuffering.set(true);

        currentBuffer = await fetchAndDecode(url);
        currentTrackUrl = url;

        if (!currentBuffer) {
            isBuffering.set(false);
            html5ActivePlayer.pause();
            isPlaying.set(false);
            return;
        }

        playerDuration.set(currentBuffer.duration);
        pauseOffset = 0;

        // Lock native player back to 0 perfectly inline with Gapless source
        html5ActivePlayer.currentTime = 0;

        playWebAudio();
        isBuffering.set(false);
        playAudioCue('resume', 0.08);
    } else {
        isPlaying.set(true);
        playAudioCue('resume', 0.08);
    }
};

export const togglePlayGlobal = () => {
    if (!isEngineInitialized) unlockAudioContext();

    if (isWebAudioMode) {
        if (get(isPlaying)) {
            pauseWebAudio();
        } else {
            playWebAudio();
            playAudioCue('resume', 0.08);
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
            playAudioCue('resume', 0.08);
        } else {
            html5ActivePlayer.pause();
            isPlaying.set(false);
            playAudioCue('pause');
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

let lastNextTime = 0;

export const playNextGlobal = async (api) => {
    const now = Date.now();
    if (now - lastNextTime < 500) return;
    lastNextTime = now;

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
            activePlayer.pause();
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

    if (activePlayer.currentTime > 3) {
        activePlayer.currentTime = 0;
    } else if (shuffle && history.length > 0) {
        const prevIndex = history.pop();
        shuffleHistory.set(history);
        currentIndex.set(prevIndex);
    } else {
        currentIndex.set((index - 1 + playlist.length) % playlist.length);
    }
};
