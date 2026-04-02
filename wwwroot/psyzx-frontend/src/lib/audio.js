export let audioCtx;
export let gainNode;
let globalAudioEl = null;

let eqFilters = [];
const EQ_FREQS = [60, 250, 1000, 4000, 8000, 14000];
let isEngineInitialized = false;

export const registerAudioElement = (el) => {
    globalAudioEl = el;
};

export const initAudioEngine = () => {
    if (typeof window === 'undefined' || !globalAudioEl || isEngineInitialized) return;
    
    try {
        const AudioCtx = window.AudioContext || window['webkitAudioContext'];
        if (!AudioCtx) return;
        
        if (!audioCtx) audioCtx = new AudioCtx();
        
        // Crea il nodo del volume master
        gainNode = audioCtx.createGain();
        
        // Crea i 6 nodi dell'equalizzatore chirurgico
        eqFilters = EQ_FREQS.map(freq => {
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1.4; // Campana ottimizzata per separazione frequenze
            filter.gain.value = 0;
            return filter;
        });
        
        // Routing: Media -> Gain -> EQ0 -> EQ1 ... -> EQ5 -> Destination
        const source = audioCtx.createMediaElementSource(globalAudioEl);
        source.connect(gainNode);
        
        let lastNode = gainNode;
        eqFilters.forEach(f => {
            lastNode.connect(f);
            lastNode = f;
        });
        lastNode.connect(audioCtx.destination);
        
        isEngineInitialized = true;
        
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
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