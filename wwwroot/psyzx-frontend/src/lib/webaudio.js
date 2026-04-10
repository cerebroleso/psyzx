import { get } from 'svelte/store';
import { currentPlaylist, currentIndex, isShuffle, isRepeat, shuffleHistory, isPlaying, isBuffering, playerCurrentTime, playerDuration } from '../store.js';

export let audioCtx;
export let gainNode;
let eqFilters = [];
let mixerNode = null;
let heartbeatOsc = null;

let currentBuffer = null;
let nextBuffer = null;
let currentSource = null;
let nextSource = null;

let trackStartTime = 0;
let pauseOffset = 0;
let currentTrackId = null;
let nextTrackId = null;

let animationFrameId = null;

let pendingBoost = 1.0;
let pendingEq = [0, 0, 0, 0, 0, 0];
const EQ_FREQS = [60, 250, 1000, 4000, 8000, 14000];

export let isEngineInitialized = false;
export let isWebAudioGaplessEnabled = typeof window !== 'undefined' ? localStorage.getItem('psyzx_webaudio_gapless') === 'true' : false;

export const setWebAudioGaplessMode = (enabled) => {
    isWebAudioGaplessEnabled = enabled;
    if (typeof window !== 'undefined') {
        localStorage.setItem('psyzx_webaudio_gapless', enabled.toString());
    }
};

const buildWebAudioGraph = () => {
    if (!audioCtx) return;

    if (!mixerNode) {
        mixerNode = audioCtx.createGain();
        mixerNode.gain.value = 1.0;
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
    if (isEngineInitialized) return;

    const AudioCtx = window.AudioContext || window['webkitAudioContext'];
    if (!audioCtx) audioCtx = new AudioCtx();

    audioCtx.onstatechange = () => {
        if (audioCtx.state === 'interrupted' && currentSource) {
            pauseEngine();
        }
    };

    buildWebAudioGraph();
    
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }

    isEngineInitialized = true;
};

const fetchAndDecode = async (url) => {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error();
        const arrayBuffer = await response.arrayBuffer();
        return await audioCtx.decodeAudioData(arrayBuffer);
    } catch (e) {
        return null;
    }
};

const startSyntheticClock = () => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    const loop = () => {
        if (get(isPlaying) && currentBuffer) {
            const currentRealTime = audioCtx.currentTime - trackStartTime + pauseOffset;
            playerCurrentTime.set(currentRealTime);

            if (currentRealTime >= currentBuffer.duration - 0.05) {
                handleTrackEnd();
                return;
            }
        }
        animationFrameId = requestAnimationFrame(loop);
    };
    loop();
};

export const preloadNextTrack = async (url, trackId) => {
    if (!isWebAudioGaplessEnabled || url === currentTrackId) return;
    
    const buffer = await fetchAndDecode(url);
    if (buffer) {
        nextBuffer = buffer;
        nextTrackId = trackId;
    }
};

export const loadAndPlayBuffer = async (url, trackId) => {
    if (!isEngineInitialized) unlockAudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    stopEngine();
    isBuffering.set(true);
    isPlaying.set(false);

    if (nextBuffer && trackId === nextTrackId) {
        currentBuffer = nextBuffer;
        currentTrackId = nextTrackId;
        nextBuffer = null;
        nextTrackId = null;
    } else {
        currentBuffer = await fetchAndDecode(url);
        currentTrackId = trackId;
    }

    if (!currentBuffer) {
        isBuffering.set(false);
        return;
    }

    playerDuration.set(currentBuffer.duration);
    pauseOffset = 0;
    
    playEngine();
    isBuffering.set(false);
};

export const playEngine = () => {
    if (!currentBuffer || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource.disconnect();
    }

    currentSource = audioCtx.createBufferSource();
    currentSource.buffer = currentBuffer;
    currentSource.connect(mixerNode);

    trackStartTime = audioCtx.currentTime;
    currentSource.start(0, pauseOffset);
    
    isPlaying.set(true);
    startSyntheticClock();
};

export const pauseEngine = () => {
    if (!currentSource || !audioCtx) return;

    try { currentSource.stop(); } catch(e) {}
    pauseOffset += (audioCtx.currentTime - trackStartTime);
    
    isPlaying.set(false);
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
};

export const togglePlayGlobal = () => {
    if (!isEngineInitialized) unlockAudioContext();
    
    if (get(isPlaying)) {
        pauseEngine();
    } else {
        playEngine();
    }
};

export const stopEngine = () => {
    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource.disconnect();
        currentSource = null;
    }
    pauseOffset = 0;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
};

export const seekEngine = (time) => {
    if (!currentBuffer || !audioCtx) return;
    
    const wasPlaying = get(isPlaying);
    
    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource.disconnect();
    }
    
    pauseOffset = Math.max(0, Math.min(time, currentBuffer.duration));
    playerCurrentTime.set(pauseOffset);

    if (wasPlaying) {
        playEngine();
    }
};

const handleTrackEnd = () => {
    stopEngine();
    window.dispatchEvent(new CustomEvent('track-ended'));
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
    
    navigator.mediaSession.setActionHandler('pause', handlers.pause);
    navigator.mediaSession.setActionHandler('play', handlers.play);
    
    if (handlers.seek) {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            handlers.seek(details.seekTime);
            updateMediaPositionState(details.seekTime, currentBuffer ? currentBuffer.duration : 0);
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
            pauseEngine();
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

    if (playlist.length === 0) return;

    if (pauseOffset > 3) {
        seekEngine(0);
    } else if (shuffle && history.length > 0) {
        const prevIndex = history.pop();
        shuffleHistory.set(history);
        currentIndex.set(prevIndex);
    } else {
        currentIndex.set((index - 1 + playlist.length) % playlist.length);
    }
};