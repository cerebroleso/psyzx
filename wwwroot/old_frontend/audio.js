export let audioCtx;
export let gainNode;

export const initAudioEngine = (audioEl) => {
    if (audioCtx) {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return;
    }
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        
        audioCtx = new AudioCtx();
        gainNode = audioCtx.createGain();
        
        const source = audioCtx.createMediaElementSource(audioEl);
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        const unlockAudio = () => {
            if (audioCtx.state === 'suspended') audioCtx.resume();
        };
        
        document.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
        document.addEventListener('click', unlockAudio, { once: true, passive: true });
    } catch (e) {}
};

export const setVolumeBoost = (val) => {
    if (gainNode) gainNode.gain.value = parseFloat(val);
};

export const updateMediaSession = (track, album, handlers) => {
    if (!('mediaSession' in navigator) || !track) return;

    navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: album?.artistName || 'Unknown Artist',
        album: album?.title || 'Unknown Album',
        artwork: [
            { src: album?.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : '', sizes: '512x512', type: 'image/jpeg' }
        ]
    });

    navigator.mediaSession.setActionHandler('play', handlers.play);
    navigator.mediaSession.setActionHandler('pause', handlers.pause);
    navigator.mediaSession.setActionHandler('previoustrack', handlers.prev);
    navigator.mediaSession.setActionHandler('nexttrack', handlers.next);
    navigator.mediaSession.setActionHandler('seekbackward', () => { handlers.seekRelative(-10); });
    navigator.mediaSession.setActionHandler('seekforward', () => { handlers.seekRelative(10); });
};