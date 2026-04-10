import { get } from 'svelte/store';
import { currentPlaylist, currentIndex, isShuffle, isRepeat, shuffleHistory, isPlaying, isBuffering } from '../store.js';

export let audioCtx;
export let gainNode;
let eqFilters = [];
let mixerNode = null;
let heartbeatOsc = null;

export let playerA = null;
export let playerB = null;
export let activePlayer = null;
export let standbyPlayer = null;

let gainA = null;
let gainB = null;

export let isEngineInitialized = false;
let hasDoneSilentPrime = false;
let stallTimeout = null;
export let resumePromise = Promise.resolve();

export let isGaplessEnabled = typeof window !== 'undefined' ? localStorage.getItem('psyzx_gapless') !== 'false' : true;

export const setGaplessMode = (enabled) => {
    isGaplessEnabled = enabled;
    if (typeof window !== 'undefined') {
        localStorage.setItem('psyzx_gapless', enabled.toString());
    }
};

let pendingBoost = 1.0;
let pendingEq = [0, 0, 0, 0, 0, 0];
const EQ_FREQS = [60, 250, 1000, 4000, 8000, 14000];

const SILENCE_B64 = "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjEyLjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIAD+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+AAAAAExhdmM1OC4xMzQAAAAAAAAAAAAAAAAkAAAAAAAAAAABIADZt9snAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFNRTMuMTAwA8EAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//MUZAMAAAGkAAAAAAAAA0gAAAAATEFNRTMuMTAwA8EAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !window['MSStream'];

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
    } catch (e) {
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
};

export const unlockAudioContext = () => {
    if (hasDoneSilentPrime) return;

    const AudioCtx = window.AudioContext || window['webkitAudioContext'];
    if (!audioCtx) audioCtx = new AudioCtx();

    audioCtx.onstatechange = () => {
        if ((audioCtx.state === 'interrupted' || audioCtx.state === 'suspended') && activePlayer && !activePlayer.paused) {
            audioCtx.resume().catch(() => {});
        } else if (audioCtx.state === 'running' && activePlayer && !activePlayer.paused) {
            activePlayer.pause();
            const p = activePlayer.play();
            if (p !== undefined) p.catch(() => {});
        }
    };

    buildWebAudioGraph();

    playerA.src = SILENCE_B64;
    playerB.src = SILENCE_B64;
    
    const pA = playerA.play();
    if (pA !== undefined) pA.catch(() => {});
    
    const pB = playerB.play();
    if (pB !== undefined) pB.catch(() => {});
    
    playerA.pause();
    playerB.pause();

    hasDoneSilentPrime = true;
    isEngineInitialized = true;
    
    requestAnimationFrame(checkGaplessTime);
};

const checkGaplessTime = () => {
    if (isGaplessEnabled && activePlayer && activePlayer.duration > 0 && !activePlayer.paused) {
        if (activePlayer.duration - activePlayer.currentTime <= 0.2 && !activePlayer._earlyEndFired) {
            activePlayer._earlyEndFired = true;
            activePlayer.dispatchEvent(new Event('ended'));
        }
    }
    requestAnimationFrame(checkGaplessTime);
};

export const registerAudioElements = (elA, elB) => {
    playerA = elA;
    playerB = elB;
    activePlayer = playerA;
    standbyPlayer = playerB;

    const setupListeners = (el) => {
        el.addEventListener('play', () => {
            el._earlyEndFired = false;
            clearTimeout(stallTimeout);
            stallTimeout = setTimeout(() => checkDeadlock(el), 3500);
        });

        el.addEventListener('waiting', () => {
            if (el === activePlayer) isBuffering.set(true);
        });

        el.addEventListener('playing', () => {
            if (el === activePlayer) {
                isBuffering.set(false);
                isPlaying.set(true);
            }
            clearTimeout(stallTimeout);
        });

        el.addEventListener('pause', () => {
            if (el === activePlayer) isPlaying.set(false);
            clearTimeout(stallTimeout);
        });
    };

    setupListeners(playerA);
    setupListeners(playerB);
};

const checkDeadlock = (el) => {
    const isContextStuck = audioCtx && audioCtx.state !== 'running';
    const isPlayheadStuck = !el.paused && el.currentTime === 0;

    if (isContextStuck || isPlayheadStuck) {
        window.dispatchEvent(new CustomEvent('ios-hardware-deadlock'));
        clearTimeout(stallTimeout);
    }
};

export const playAudioCue = (action, delaySeconds = 0) => {
    if (window.innerWidth > 850 || !audioCtx) return;
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
    } catch(e) {
    }
};

export const setVolumeBoost = (val) => {
    pendingBoost = parseFloat(val);
    if (gainNode && audioCtx) gainNode.gain.value = pendingBoost;
};

export const setEqBand = (index, val) => {
    pendingEq[index] = parseFloat(val);
    if (eqFilters[index] && audioCtx) {
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
        eqFilters[index].gain.value = pendingEq[index];
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
    });

    navigator.mediaSession.setActionHandler('play', async () => {
        if (audioCtx?.state === 'suspended') await audioCtx.resume();
        handlers.play();
    });

    if (handlers.seek) {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            handlers.seek(details.seekTime);
            if (activePlayer && !isNaN(activePlayer.duration)) {
                updateMediaPositionState(details.seekTime, activePlayer.duration);
            }
        });
    }
    
    navigator.mediaSession.setActionHandler('previoustrack', handlers.prev);
    navigator.mediaSession.setActionHandler('nexttrack', handlers.next);
};

export const updateMediaPositionState = (currentTime, duration) => {
    if ('mediaSession' in navigator && !isNaN(duration) && duration > 0) {
        try {
            navigator.mediaSession.setPositionState({ duration, playbackRate: 1.0, position: currentTime });
        } catch (e) {}
    }
};

export const preloadNextUrl = (url) => {
    if (!isGaplessEnabled) return;

    const targetPlayer = standbyPlayer; 

    if (targetPlayer && !targetPlayer.src.includes(url)) {
        targetPlayer.src = url;
        targetPlayer.preload = "auto";
        
        const targetGain = targetPlayer === playerA ? gainA : gainB;
        if (targetGain && audioCtx) {
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
};

export const loadAndPlayUrl = async (url) => {
    if (!hasDoneSilentPrime) unlockAudioContext(); 
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    const oldPlayer = activePlayer;
    activePlayer = standbyPlayer;
    standbyPlayer = oldPlayer; 

    const activeTargetGain = activePlayer === playerA ? gainA : gainB;
    const oldTargetGain = standbyPlayer === playerA ? gainA : gainB;

    if (isGaplessEnabled && audioCtx) {
        if (oldTargetGain && !standbyPlayer.paused) {
            oldTargetGain.gain.cancelScheduledValues(audioCtx.currentTime);
            oldTargetGain.gain.setValueAtTime(oldTargetGain.gain.value, audioCtx.currentTime);
            oldTargetGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
            
            setTimeout(() => {
                standbyPlayer.pause();
            }, 250);
        } else {
            standbyPlayer.pause();
        }

        if (activeTargetGain) {
            activeTargetGain.gain.cancelScheduledValues(audioCtx.currentTime);
            activeTargetGain.gain.setValueAtTime(0, audioCtx.currentTime);
            activeTargetGain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.05);
        }
    } else {
        standbyPlayer.pause();
        if (activeTargetGain && audioCtx) {
            activeTargetGain.gain.cancelScheduledValues(audioCtx.currentTime);
            activeTargetGain.gain.value = 1;
        }
    }

    if (!activePlayer.src.includes(url)) {
        activePlayer.src = url;
        activePlayer.load(); 
        activePlayer.currentTime = 0;
    } else if (activePlayer.currentTime > 0.5) {
        activePlayer.currentTime = 0;
    }
    
    try {
        const playPromise = activePlayer.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => {});
        }
        
        isPlaying.set(true);
        playAudioCue('resume', 0.08); 
    } catch (e) {
        isPlaying.set(false);
    }
};

export const togglePlayGlobal = () => { 
    if (!activePlayer) return;
    
    if (!hasDoneSilentPrime) unlockAudioContext(); 
    
    if (activePlayer.paused) { 
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        
        const activeTargetGain = activePlayer === playerA ? gainA : gainB;
        if (activeTargetGain && audioCtx) {
            activeTargetGain.gain.cancelScheduledValues(audioCtx.currentTime);
            activeTargetGain.gain.value = 1;
        }

        const playPromise = activePlayer.play(); 
        if (playPromise !== undefined) {
            playPromise.catch(() => {});
        }

        isPlaying.set(true); 
        playAudioCue('resume', 0.08);
    } else { 
        activePlayer.pause(); 
        isPlaying.set(false);
        playAudioCue('pause');
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
            if (activePlayer) activePlayer.pause();
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
    const playlist = get(currentPlaylist);
    const index = get(currentIndex);
    const shuffle = get(isShuffle);
    const history = get(shuffleHistory);

    if (!activePlayer || playlist.length === 0) return;

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