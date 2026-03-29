import { DOM } from './dom.js';

export const audioState = {
    audioCtx: null,
    source: null,
    f60: null,
    f250: null,
    f1k: null,
    f4k: null,
    f8k: null,
    f14k: null,
    eqInitialized: false
};

export const initEQ = () => {
    if (audioState.eqInitialized) return;
    try {
        audioState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioState.source = audioState.audioCtx.createMediaElementSource(DOM.audioEl);
        
        const createFilter = (freq, type = 'peaking') => {
            const f = audioState.audioCtx.createBiquadFilter();
            f.type = type;
            f.frequency.value = freq;
            if (type === 'peaking') f.Q.value = 1;
            return f;
        };

        audioState.f60 = createFilter(60, 'lowshelf');
        audioState.f250 = createFilter(250);
        audioState.f1k = createFilter(1000);
        audioState.f4k = createFilter(4000);
        audioState.f8k = createFilter(8000);
        audioState.f14k = createFilter(14000, 'highshelf');
        
        audioState.source.connect(audioState.f60);
        audioState.f60.connect(audioState.f250);
        audioState.f250.connect(audioState.f1k);
        audioState.f1k.connect(audioState.f4k);
        audioState.f4k.connect(audioState.f8k);
        audioState.f8k.connect(audioState.f14k);
        audioState.f14k.connect(audioState.audioCtx.destination);
        
        audioState.eqInitialized = true;
    } catch (e) {}
};

export const syncVolume = (val) => {
    DOM.audioEl.volume = val / 100;
    if (DOM.volSlider) DOM.volSlider.value = val;
    if (DOM.fpVolSlider) DOM.fpVolSlider.value = val;
};

export const setupAudioEvents = () => {
    const sliders = [
        { el: DOM.eq60, filter: 'f60' },
        { el: DOM.eq250, filter: 'f250' },
        { el: DOM.eq1k, filter: 'f1k' },
        { el: DOM.eq4k, filter: 'f4k' },
        { el: DOM.eq8k, filter: 'f8k' },
        { el: DOM.eq14k, filter: 'f14k' }
    ];

    sliders.forEach(s => {
        if (!s.el) return;
        s.el.addEventListener('input', (e) => {
            initEQ();
            if(audioState.audioCtx && audioState.audioCtx.state === 'suspended') audioState.audioCtx.resume();
            const val = parseFloat(e.target.value);
            if (audioState[s.filter]) audioState[s.filter].gain.value = val;
        });
    });

    if(DOM.volSlider) DOM.volSlider.addEventListener('input', (e) => syncVolume(e.target.value));
    if(DOM.fpVolSlider) DOM.fpVolSlider.addEventListener('input', (e) => syncVolume(e.target.value));
};