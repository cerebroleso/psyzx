export let audioCtx;
export let gainNode;
let globalAudioEl = null;

export const registerAudioElement = (el) => {
    globalAudioEl = el;
};

export const initAudioEngine = () => {
    if (typeof window === 'undefined' || !globalAudioEl) return;
    if (audioCtx) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return;
    }
    try {
        const AudioCtx = window.AudioContext || window['webkitAudioContext'];
        if (!AudioCtx) return;
        
        audioCtx = new AudioCtx();
        gainNode = audioCtx.createGain();
        
        const source = audioCtx.createMediaElementSource(globalAudioEl);
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
};

export const setVolumeBoost = (val) => {
    const num = parseFloat(val);
    if (num > 1.0 && !audioCtx) {
        initAudioEngine();
    }
    if (gainNode) {
        gainNode.gain.value = num;
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