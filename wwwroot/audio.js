import { DOM } from './dom.js';

export let audioCtx;
export let gainNode;

export const initAudioEngine = () => {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        gainNode = audioCtx.createGain();
        const source = audioCtx.createMediaElementSource(DOM.audioEl);
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        const savedBoost = localStorage.getItem('psyzx_boost') || '1.0';
        gainNode.gain.value = parseFloat(savedBoost);
    } catch (e) {
        console.error("Audio Engine bloccato o non supportato", e);
    }
};

export const setVolumeBoost = (val) => {
    if (gainNode) gainNode.gain.value = parseFloat(val);
};

export const syncVolume = (val) => {
    DOM.audioEl.volume = val / 100;
    if (DOM.volSlider) DOM.volSlider.value = val;
    if (DOM.fpVolSlider) DOM.fpVolSlider.value = val;
};

export const setupAudioEvents = () => {
    const init = () => {
        initAudioEngine();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        document.removeEventListener('click', init);
        document.removeEventListener('touchstart', init);
    };
    
    document.addEventListener('click', init);
    document.addEventListener('touchstart', init, {passive: true});
    
    DOM.audioEl.addEventListener('play', () => {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    });

    if (DOM.volSlider) DOM.volSlider.addEventListener('input', e => syncVolume(e.target.value));
    if (DOM.fpVolSlider) DOM.fpVolSlider.addEventListener('input', e => syncVolume(e.target.value));
};