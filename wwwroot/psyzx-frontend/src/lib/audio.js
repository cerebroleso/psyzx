/**
 * audioEngine.js — Gapless WebAudio engine with MSE streaming
 *
 * Architecture overview
 * ─────────────────────
 * MSE phase  (new track, fast start):
 * fetch stream → SourceBuffer → msePlayer (HTMLAudioElement)
 * → MediaElementSource → mseGain → mixerNode
 * In parallel: accumulate chunks → decodeAudioData → decodeCache
 *
 * Buffer phase (gapless rollover / MSE fallback):
 * decodeCache[url] → AudioBufferSourceNode → mixerNode
 *
 * Keep-alive (iOS PWA):
 * playerA / playerB (HTML5) → MediaElementSource → gainA/B → mixerNode
 * gainA/B held at 0.0001 so they stay active but are inaudible
 * silentPlayer loops 1-byte silence to hold background audio session
 *
 * Signal chain:
 * mixerNode → analyserNode → EQ[0..5] → gainNode(boost) → masterVolumeNode → destination
 */

import { get } from 'svelte/store';
import {
    currentPlaylist, currentIndex, isShuffle, isRepeat,
    shuffleHistory, shuffleFuture, userQueue, isPlaying, isBuffering,
    playerCurrentTime, playerDuration,
} from '../store.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CACHE_SIZE        = 3;
const FFT_SIZE              = 256;
const EQ_FREQS              = [60, 250, 1000, 4000, 8000, 14000];
const MIN_MSE_BUFFER_SECS   = 3;      
const ROLLOVER_THRESHOLD    = 0.3;    

const SILENCE_B64 = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAAE=';

// ─── Exported state ───────────────────────────────────────────────────────────

export let audioCtx             = null;
export let gainNode             = null;   
export let analyserNode         = null;
export let isEngineInitialized  = false;
export let isWebAudioMode;

{
    const saved = typeof window !== 'undefined' ? localStorage.getItem('psyzx_webaudio_gapless') : null;
    isWebAudioMode = saved === null ? true : saved === 'true';
}

export const setWebAudioGaplessMode = (enabled) => {
    isWebAudioMode = enabled;
    if (typeof window !== 'undefined') localStorage.setItem('psyzx_webaudio_gapless', String(enabled));
};

export const getBufferedPct = () => {
    if (isWebAudioMode) {
        if (currentBuffer) return 100; 
        if (mseActive && msePlayer && msePlayer.duration > 0 && msePlayer.buffered.length > 0) {
            return (msePlayer.buffered.end(msePlayer.buffered.length - 1) / msePlayer.duration) * 100;
        }
    } else {
        if (html5ActivePlayer && html5ActivePlayer.duration > 0 && html5ActivePlayer.buffered.length > 0) {
            return (html5ActivePlayer.buffered.end(html5ActivePlayer.buffered.length - 1) / html5ActivePlayer.duration) * 100;
        }
    }
    return 0;
};

// ─── Private audio graph ──────────────────────────────────────────────────────

let masterVolumeNode    = null;
let mixerNode           = null;
let heartbeatOsc        = null;
let eqFilters           = [];

// ─── HTML5 keep-alive pair ────────────────────────────────────────────────────

export let playerA          = null;
export let playerB          = null;
let html5ActivePlayer       = null;
let html5StandbyPlayer      = null;
let gainA                   = null;
let gainB                   = null;

// ─── MSE streaming layer ──────────────────────────────────────────────────────

let msePlayer               = null;   
let mseGain                 = null;   
let mseWired                = false;
let mseActive               = false;  
let mseAbortCtrl            = null;
let mseMediaSource          = null;
let mseObjectUrl            = null;

// ─── WebAudio buffer state ────────────────────────────────────────────────────

let currentBuffer           = null;
let trackStartTime          = 0;      
let pauseOffset             = 0;      
let currentTrackUrl         = null;

let activeSources           = new Set();
let pendingLoadId           = 0;

let syntheticClockInterval  = null;
const decodeCache           = new Map();  

// ─── Misc module state ────────────────────────────────────────────────────────

let hasDoneSilentPrime      = false;
let stallTimeout            = null;
let silentPlayer            = null;
let scrubOsc                = null;
let scrubGain               = null;
let bufferOsc               = null;
let bufferGain              = null;
let bufferInterval          = null;

let pendingBoost    = 1.0;
let pendingVolume   = 1.0;
let pendingEq       = [0, 0, 0, 0, 0, 0];

const dataArray = typeof window !== 'undefined' ? new Uint8Array(FFT_SIZE / 2) : null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const safeDecodeAudioData = (buffer) => {
    return new Promise((resolve, reject) => {
        // FIX: Lazily instantiate audioCtx if a gapless preload triggers 
        // before the engine is formally unlocked by a user gesture.
        if (!audioCtx) {
            const Ctor = window.AudioContext || window['webkitAudioContext'];
            if (Ctor) {
                audioCtx = new Ctor();
            } else {
                return reject(new Error('WebAudio API is not supported in this browser.'));
            }
        }

        let settled = false;
        const done = (decoded) => { if (!settled) { settled = true; resolve(decoded); } };
        const fail = (error) => { if (!settled) { settled = true; reject(error || new Error('Decode failed')); } };

        try {
            const promise = audioCtx.decodeAudioData(buffer, done, fail);
            // Crucial for Firefox: hook into the returned Promise if it exists
            if (promise && typeof promise.catch === 'function') {
                promise.then(done).catch(fail);
            }
        } catch (e) {
            fail(e);
        }
    });
};

// --- DIAGNOSTIC TELEMETRY ---
let activeDecodes       = 0;
let mseLoadedBytes      = 0;
let mseFetchComplete    = false;

export const getAudioDiagnostics = () => {
    return {
        mode: isWebAudioMode ? 'WebAudio API' : 'HTML5 Fallback',
        ctxState: audioCtx ? audioCtx.state : 'Uninitialized',
        mseActive: mseActive,
        mseReadyState: mseMediaSource ? mseMediaSource.readyState : 'N/A',
        mseWired: mseWired,
        bufferDecoded: !!currentBuffer,
        cacheSize: decodeCache.size,
        activeSources: activeSources.size,
        html5Status: html5ActivePlayer 
            ? `readyState: ${html5ActivePlayer.readyState}, netState: ${html5ActivePlayer.networkState}` 
            : 'Uninitialized',
        // New Telemetry
        mseLoadedBytes,
        mseFetchComplete,
        activeDecodes
    };
};

const buildStreamUrl = (url, useMse = false) => {
    const kbps = typeof window !== 'undefined' ? (localStorage.getItem('psyzx_bitrate') || '320') : '320';
    const separator = url.includes('?') ? '&' : '?';
    const formatStr = useMse ? '&format=mp4' : '';
    return `${url}${separator}kbps=${kbps}${formatStr}`;
};

const normaliseUrl = (u) => {
    if (!u) return '';
    try {
        return new URL(u, typeof window !== 'undefined' ? window.location.href : 'http://localhost').href;
    } catch {
        return u;
    }
};

const srcMatchesUrl = (elementSrc, trackUrl) => {
    if (!elementSrc || !trackUrl) return false;
    return normaliseUrl(elementSrc) === normaliseUrl(buildStreamUrl(trackUrl, false));
};

// ─── FFT ──────────────────────────────────────────────────────────────────────

export const getFftData = () => {
    if (analyserNode && audioCtx?.state === 'running') {
        analyserNode.getByteFrequencyData(dataArray);
        return dataArray;
    }
    return null;
};

// ─── Active-player façade ─────────────────────────────────────────────────────

export const activePlayer = {
    get currentTime() {
        return isWebAudioMode
            ? get(playerCurrentTime)
            : (html5ActivePlayer?.currentTime ?? 0);
    },
    set currentTime(t) {
        if (isWebAudioMode) seekWebAudio(t);
        else if (html5ActivePlayer) {
            try {
                if (html5ActivePlayer.fastSeek) html5ActivePlayer.fastSeek(t);
                else html5ActivePlayer.currentTime = t;
            } catch {}
        }
    },
    get duration()  { return isWebAudioMode ? get(playerDuration) : (html5ActivePlayer?.duration ?? 0); },
    get paused()    { return !get(isPlaying); },
    play:  async () => { if (isWebAudioMode) return playWebAudio(); else return html5ActivePlayer?.play(); },
    pause: ()      => { if (isWebAudioMode) pauseWebAudio(); else html5ActivePlayer?.pause(); },
    load:  ()      => { if (!isWebAudioMode) html5ActivePlayer?.load(); },
    get src()      { return isWebAudioMode ? (currentTrackUrl ?? '') : (html5ActivePlayer?.src ?? ''); },
    set src(v)     { if (!isWebAudioMode && html5ActivePlayer) html5ActivePlayer.src = v; },
};

// ─── Silent keep-alive ────────────────────────────────────────────────────────

const initSilentPlayer = () => {
    if (typeof document === 'undefined' || silentPlayer) return;
    silentPlayer = document.createElement('audio');
    silentPlayer.src          = SILENCE_B64;
    silentPlayer.loop         = true;
    silentPlayer.volume       = 0.0001;
    silentPlayer.preload      = 'auto';
    silentPlayer.autoplay     = false;
    try { silentPlayer.disableRemotePlayback = true; } catch {}
    silentPlayer.setAttribute('playsinline',          '');
    silentPlayer.setAttribute('webkit-playsinline',   '');
    silentPlayer.setAttribute('aria-hidden',          'true');
    silentPlayer.setAttribute('x-webkit-airplay',     'allow');
    silentPlayer.style.cssText =
        'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(silentPlayer);
};

const startSilentKeepAlive = () => {
    initSilentPlayer();
    if (!silentPlayer) return;
    try { silentPlayer.loop = true; silentPlayer.volume = 0.0001; }catch {}
    const p = silentPlayer.play();
    if (p) p.catch(() => {});
};

const stopSilentKeepAlive = () => {
    if (!silentPlayer) return;
    try { silentPlayer.pause(); silentPlayer.currentTime = 0; } catch {}
};

// ─── MSE helpers ──────────────────────────────────────────────────────────────

const pickMseMime = (serverContentType) => {
    if (typeof MediaSource === 'undefined') return null;
    const raw = (serverContentType || '').split(';')[0].trim().toLowerCase();
    const candidates = raw
        ? [raw, 'audio/mp4; codecs="mp4a.40.2"', 'audio/mpeg']
        : ['audio/mp4; codecs="mp4a.40.2"', 'audio/mpeg'];
    return candidates.find(m => MediaSource.isTypeSupported(m)) ?? null;
};

const initMsePlayer = () => {
    if (msePlayer || typeof document === 'undefined') return;
    msePlayer = document.createElement('audio');
    msePlayer.preload   = 'none';
    try { msePlayer.disableRemotePlayback = true; } catch {}
    msePlayer.setAttribute('playsinline',        '');
    msePlayer.setAttribute('webkit-playsinline', '');
    msePlayer.style.cssText =
        'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(msePlayer);

    msePlayer.addEventListener('timeupdate', () => {
        if (!mseActive || msePlayer._earlyEndFired) return;
        const dur = msePlayer.duration;
        if (dur > 0 && dur - msePlayer.currentTime <= 0.15) {
            msePlayer._earlyEndFired = true;
            window.dispatchEvent(new CustomEvent('track-ended'));
        }
    }, { passive: true });

    msePlayer.addEventListener('ended', () => {
        if (!mseActive || msePlayer._earlyEndFired) return;
        msePlayer._earlyEndFired = true;
        window.dispatchEvent(new CustomEvent('track-ended'));
    });

    msePlayer.addEventListener('waiting', () => {
        if (mseActive && get(isPlaying)) isBuffering.set(true);
    }, { passive: true });

    msePlayer.addEventListener('playing', () => {
        if (mseActive) { isBuffering.set(false); stopBufferSound(); }
    }, { passive: true });

    msePlayer.addEventListener('error', () => {
        if (!mseActive) return;
        console.error('MSE player error', msePlayer.error);
        teardownMse();
        window.dispatchEvent(new CustomEvent('track-load-error'));
    });
};

const wireMsePlayer = () => {
    if (!audioCtx || !msePlayer || mseWired || !mixerNode) return;
    mseGain = audioCtx.createGain();
    mseGain.gain.value = 0;
    try {
        const src = audioCtx.createMediaElementSource(msePlayer);
        src.connect(mseGain);
    } catch (e) { console.warn('MSE wire warning', e); }
    mseGain.connect(mixerNode);
    mseWired = true;
};

const teardownMse = () => {
    mseActive = false;
    if (mseAbortCtrl) { mseAbortCtrl.abort(); mseAbortCtrl = null; }
    if (msePlayer) {
        msePlayer._earlyEndFired = true; 
        try { 
            msePlayer.pause(); 
            msePlayer.removeAttribute('src'); 
            msePlayer.load();
        } catch {}
    }
    if (mseGain && audioCtx) {
        const now = audioCtx.currentTime;
        mseGain.gain.cancelScheduledValues(now);
        mseGain.gain.setTargetAtTime(0, now, 0.05);
    }
    if (mseMediaSource) {
        try { if (mseMediaSource.readyState === 'open') mseMediaSource.endOfStream(); } catch {}
        mseMediaSource = null;
    }
    if (mseObjectUrl) { URL.revokeObjectURL(mseObjectUrl); mseObjectUrl = null; }
};

const streamViaMse = async (url, loadId) => {
    if (typeof MediaSource === 'undefined' || !msePlayer || !mseWired) return false;

    const abortCtrl = new AbortController();
    mseAbortCtrl    = abortCtrl;

    mseLoadedBytes = 0;
    mseFetchComplete = false;

    try {
        const streamUrl = buildStreamUrl(url, true);
        const response  = await fetch(streamUrl, { signal: abortCtrl.signal });
        if (!response.ok) return false;

        const serverMime = response.headers.get('content-type') || '';
        const mimeType   = pickMseMime(serverMime);
        if (!mimeType) return false;

        const ms     = new MediaSource();
        mseMediaSource = ms;
        const objUrl = URL.createObjectURL(ms);
        mseObjectUrl = objUrl;
        msePlayer.src = objUrl;
        msePlayer._earlyEndFired = false;

        await new Promise((resolve, reject) => {
            const onOpen  = () => { ms.removeEventListener('sourceopen', onOpen); resolve(); };
            const onErr   = () => { ms.removeEventListener('error', onErr); reject(new Error('MSE open error')); };
            ms.addEventListener('sourceopen', onOpen);
            ms.addEventListener('error', onErr);
            setTimeout(() => reject(new Error('MSE sourceopen timeout')), 5000);
        });

        if (loadId !== pendingLoadId) { teardownMse(); return true; }

        const sb = ms.addSourceBuffer(mimeType);
        sb.mode  = 'sequence';

        mseActive = true;
        if (mseGain && audioCtx) {
            const now = audioCtx.currentTime;
            mseGain.gain.cancelScheduledValues(now);
            mseGain.gain.setValueAtTime(0, now);
            mseGain.gain.linearRampToValueAtTime(1.0, now + 0.05);
        }
        if (gainA && audioCtx) gainA.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.01);
        if (gainB && audioCtx) gainB.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.01);

        const appendChunk = async (chunk) => {
            if (sb.updating) {
                await new Promise(r => sb.addEventListener('updateend', r, { once: true }));
            }
            if (!mseMediaSource || mseMediaSource.readyState !== 'open') return;

            try {
                sb.appendBuffer(chunk);
                await new Promise(r => sb.addEventListener('updateend', r, { once: true }));
            } catch (e) {
                if (e.name === 'QuotaExceededError') {
                    const trimTo = Math.max(0, (msePlayer.currentTime || 0) - 10);
                    if (sb.buffered.length > 0 && trimTo > sb.buffered.start(0)) {
                        sb.remove(sb.buffered.start(0), trimTo);
                        await new Promise(r => sb.addEventListener('updateend', r, { once: true }));
                        sb.appendBuffer(chunk);
                        await new Promise(r => sb.addEventListener('updateend', r, { once: true }));
                    }
                } else throw e;
            }
        };

        const reader      = response.body.getReader();
        const allChunks   = [];
        let totalBytes    = 0;
        let playStarted   = false;

        isBuffering.set(true);
        startBufferSound();

        while (true) {
            if (loadId !== pendingLoadId) { reader.cancel(); teardownMse(); return true; }

            const { done, value } = await reader.read();
            if (done) break;

            allChunks.push(value);
            totalBytes += value.byteLength;
            mseLoadedBytes = totalBytes;
            await appendChunk(value);

            if (!playStarted && msePlayer.buffered.length > 0 &&
                msePlayer.buffered.end(0) >= MIN_MSE_BUFFER_SECS) {
                playStarted    = true;
                msePlayer.currentTime = 0;

                if (audioCtx?.state === 'suspended') await audioCtx.resume().catch(() => {});
                const p = msePlayer.play();
                if (p) await p.catch(() => startSilentKeepAlive());

                currentTrackUrl = url;
                isPlaying.set(true);
                isBuffering.set(false);
                stopBufferSound();
                startSyntheticClock();
                if (msePlayer.duration > 0) playerDuration.set(msePlayer.duration);
                updateMediaPositionState(0, msePlayer.duration || 0);
            }
        }

        mseFetchComplete = true;

        if (totalBytes === 0) {
            teardownMse();
            return false; 
        }

        if (ms.readyState === 'open') {
            if (sb.updating) await new Promise(r => sb.addEventListener('updateend', r, { once: true }));
            ms.endOfStream();
        }

        if (!playStarted && loadId === pendingLoadId) {
            if (audioCtx?.state === 'suspended') await audioCtx.resume().catch(() => {});
            const p = msePlayer.play();
            if (p) p.catch(() => startSilentKeepAlive());
            currentTrackUrl = url;
            isPlaying.set(true);
            isBuffering.set(false);
            stopBufferSound();
            startSyntheticClock();
        }

        // ── Background decode for gapless cache ───────────────────────────────
        if (loadId === pendingLoadId && allChunks.length > 0 && audioCtx) {
            activeDecodes++;
            const combined = new Uint8Array(totalBytes);
            let off = 0;
            for (const c of allChunks) { combined.set(c, off); off += c.byteLength; }

            safeDecodeAudioData(combined.buffer.slice(0))
            .then(buf => {
                if (loadId !== pendingLoadId) return;
                if (decodeCache.size >= MAX_CACHE_SIZE) {
                    const oldest = decodeCache.keys().next().value;
                    const old    = decodeCache.get(oldest);
                    if (old?.controller) old.controller.abort();
                    decodeCache.delete(oldest);
                }
                decodeCache.set(url, { promise: Promise.resolve(buf), controller: null, resolved: true });
                currentBuffer = buf;
                playerDuration.set(buf.duration);
            })
            .catch(() => { /* non-fatal: MSE is still playing, Firefox just didn't like the chunks */ })
            .finally(() => { activeDecodes--; }); 
        }

        return true;

    } catch (e) {
        if (e.name !== 'AbortError') console.error('MSE stream error:', e);
        teardownMse();
        return false;
    }
};

// ─── WebAudio graph construction ──────────────────────────────────────────────

const buildWebAudioGraph = () => {
    if (!audioCtx || mixerNode) return; 

    mixerNode = audioCtx.createGain();
    mixerNode.gain.value = 1.0;

    const hGain = audioCtx.createGain();
    hGain.gain.value = 0.0000001;
    heartbeatOsc = audioCtx.createOscillator();
    heartbeatOsc.type           = 'sine';
    heartbeatOsc.frequency.value = 440;
    heartbeatOsc.connect(hGain);
    hGain.connect(mixerNode);
    heartbeatOsc.start();

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize                  = FFT_SIZE;
    analyserNode.smoothingTimeConstant    = 0.85;

    eqFilters = EQ_FREQS.map((freq, i) => {
        const f = audioCtx.createBiquadFilter();
        f.type            = 'peaking';
        f.frequency.value = freq;
        f.Q.value         = 1.4;
        f.gain.value      = pendingEq[i];
        return f;
    });

    gainNode = audioCtx.createGain();
    gainNode.gain.value = pendingBoost;

    masterVolumeNode = audioCtx.createGain();
    masterVolumeNode.gain.value = pendingVolume;

    mixerNode.connect(analyserNode);
    analyserNode.connect(eqFilters[0]);
    for (let i = 0; i < eqFilters.length - 1; i++) eqFilters[i].connect(eqFilters[i + 1]);
    eqFilters[eqFilters.length - 1].connect(gainNode);
    gainNode.connect(masterVolumeNode);
    masterVolumeNode.connect(audioCtx.destination);
};

const tryWireAudioNodes = () => {
    if (!audioCtx || !playerA || !playerB || gainA || !mixerNode) return;
    
    gainA = audioCtx.createGain(); gainA.gain.value = 0;
    gainB = audioCtx.createGain(); gainB.gain.value = 0;
    
    try {
        const srcA = audioCtx.createMediaElementSource(playerA);
        const srcB = audioCtx.createMediaElementSource(playerB);
        srcA.connect(gainA);
        srcB.connect(gainB);
    } catch (e) { console.warn('HTML5 wire warning', e); }
    
    gainA.connect(mixerNode);
    gainB.connect(mixerNode);
    
    wireMsePlayer();
};

// ─── Decode cache (full-fetch path) ──────────────────────────────────────────

const fetchAndDecode = async (url) => {
    if (decodeCache.has(url)) return decodeCache.get(url).promise;

    if (decodeCache.size >= MAX_CACHE_SIZE) {
        const oldest = decodeCache.keys().next().value;
        const entry  = decodeCache.get(oldest);
        if (entry?.controller) entry.controller.abort();
        decodeCache.delete(oldest);
    }

    const controller = new AbortController();
    activeDecodes++;
    const p = (async () => {
        try {
            const resp = await fetch(buildStreamUrl(url, false), { signal: controller.signal });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const ab = await resp.arrayBuffer();
            
            const decoded = await safeDecodeAudioData(ab.slice(0));
            
            // FIX: Mark the cache entry as fully resolved
            const entry = decodeCache.get(url);
            if (entry) entry.resolved = true;
            
            return decoded;
        } catch (e) {
            if (e.name !== 'AbortError') console.error('Audio decode error:', e);
            return null;
        }
    })().finally(() => { activeDecodes--; });

    // FIX: Add resolved: false initially
    decodeCache.set(url, { promise: p, controller, resolved: false });
    return p;
};

// ─── Synthetic clock ──────────────────────────────────────────────────────────

const startSyntheticClock = () => {
    if (syntheticClockInterval) clearInterval(syntheticClockInterval);
    let syncPulse = 0;
    let lastPos = -1;
    let stuckTicks = 0;

    syntheticClockInterval = setInterval(() => {
        if (!get(isPlaying)) {
            stuckTicks = 0;
            return;
        }

        let pos, dur;

        if (isWebAudioMode) {
            if (mseActive && msePlayer) {
                pos = msePlayer.currentTime;
                dur = msePlayer.duration > 0 ? msePlayer.duration : get(playerDuration);
                if (msePlayer.duration > 0) playerDuration.set(msePlayer.duration);
            } else if (currentBuffer && audioCtx) {
                const elapsed = audioCtx.currentTime - trackStartTime;
                dur = currentBuffer.duration;
                pos = Math.max(0, Math.min(pauseOffset + elapsed, dur));
            } else return;
        } else {
            // HTML5 fallback mode — read directly from the active element
            if (!html5ActivePlayer || html5ActivePlayer.readyState < 1) return;
            pos = html5ActivePlayer.currentTime;
            dur = html5ActivePlayer.duration > 0 ? html5ActivePlayer.duration : get(playerDuration);
        }

        if (pos === lastPos && !get(isBuffering)) {
            stuckTicks++;
            if (stuckTicks > 25) {
                console.warn("[Watchdog] Audio engine stalled. Forcing hardware recovery...");
                stuckTicks = 0;
                attemptHardwareRecovery(pos);
            }
        } else {
            stuckTicks = 0;
            lastPos = pos;
        }

        playerCurrentTime.set(pos);

        syncPulse++;
        if (syncPulse >= 10) {
            syncPulse = 0;
            if (dur > 0) updateMediaPositionState(pos, dur);

            // WebAudio mode: keep HTML5 element in sync as keep-alive
            if (isWebAudioMode && !mseActive && html5ActivePlayer) {
                if (html5ActivePlayer.paused) {
                    const p = html5ActivePlayer.play(); if (p) p.catch(() => {});
                }
                if (Math.abs(html5ActivePlayer.currentTime - pos) > 1.0) {
                    try { html5ActivePlayer.currentTime = pos; } catch {}
                }
            }
        }
    }, 100);
};

// ─── WebAudio buffer playback ─────────────────────────────────────────────────

const playWebAudio = () => {
    if (!currentBuffer || !audioCtx || get(isPlaying)) return;

    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    if (html5ActivePlayer?.paused) {
        const p = html5ActivePlayer.play();
        if (p) p.then(() => stopSilentKeepAlive()).catch(() => startSilentKeepAlive());
    } else if (!html5ActivePlayer) startSilentKeepAlive();

    const src = audioCtx.createBufferSource();
    src.buffer = currentBuffer;
    src.connect(mixerNode);

    src.onended = () => {
        activeSources.delete(src); 
        src.buffer = null; 
        if (get(isPlaying)) {
            window.dispatchEvent(new CustomEvent('track-ended'));
        }
    };

    trackStartTime = audioCtx.currentTime;
    src.start(0, pauseOffset);
    activeSources.add(src);

    isPlaying.set(true);
    startSyntheticClock();
    updateMediaPositionState(pauseOffset, currentBuffer.duration);
};

const scheduleGaplessNext = (nextBuf) => {
    if (!audioCtx || !nextBuf) {
        currentBuffer = nextBuf;
        pauseOffset   = 0;
        if (nextBuf) playerDuration.set(nextBuf.duration);
        playWebAudio();
        return;
    }

    const currentEndAt = currentBuffer
        ? trackStartTime + (currentBuffer.duration - pauseOffset)
        : audioCtx.currentTime;
    const startAt = Math.max(audioCtx.currentTime, currentEndAt);

    currentBuffer = nextBuf;
    pauseOffset   = 0;
    playerDuration.set(nextBuf.duration);

    const src = audioCtx.createBufferSource();
    src.buffer = nextBuf;
    src.connect(mixerNode);

    const capturedDuration = nextBuf.duration;
    src.onended = () => {
        activeSources.delete(src); 
        src.buffer = null;
        if (get(isPlaying)) {
            window.dispatchEvent(new CustomEvent('track-ended'));
        }
    };

    src.start(startAt, 0);
    activeSources.add(src);

    trackStartTime = startAt;
    updateMediaPositionState(0, capturedDuration);
};

const pauseWebAudio = () => {
    const wasPlaying = get(isPlaying);

    activeSources.forEach(src => {
        try { src.onended = null; src.stop(); src.disconnect(); src.buffer = null; } catch {}
    });
    activeSources.clear();

    if (wasPlaying && audioCtx) {
        pauseOffset += Math.max(0, audioCtx.currentTime - trackStartTime);
    }

    if (mseActive && msePlayer) {
        try { msePlayer.pause(); } catch {}
    }

    if (html5ActivePlayer && !html5ActivePlayer.paused) html5ActivePlayer.pause();
    stopSilentKeepAlive();
    isPlaying.set(false);

    if (syntheticClockInterval) clearInterval(syntheticClockInterval);

    const dur = get(playerDuration);
    if (dur > 0) updateMediaPositionState(pauseOffset, dur);
};

const stopWebAudio = () => {
    activeSources.forEach(src => {
        try { src.onended = null; src.stop(); src.disconnect(); src.buffer = null; } catch {}
    });
    activeSources.clear();
    pauseOffset = 0;
    if (syntheticClockInterval) clearInterval(syntheticClockInterval);
};

const seekWebAudio = (time) => {
    if (!audioCtx) return;
    const wasPlaying = get(isPlaying);
    if (wasPlaying) isPlaying.set(false);

    stopWebAudio();

    if (mseActive && msePlayer) {
        try { msePlayer.currentTime = time; } catch {}
    }

    const maxTime  = currentBuffer?.duration ?? (msePlayer?.duration ?? 0);
    pauseOffset    = Math.max(0, Math.min(time, maxTime));
    playerCurrentTime.set(pauseOffset);

    if (html5ActivePlayer) try { html5ActivePlayer.currentTime = pauseOffset; } catch {}

    if (wasPlaying) {
        if (mseActive && msePlayer) {
            const p = msePlayer.play(); if (p) p.catch(() => {});
            isPlaying.set(true);
            startSyntheticClock();
        } else playWebAudio();
    } else {
        const dur = get(playerDuration);
        if (dur > 0) updateMediaPositionState(pauseOffset, dur);
    }
};

const attemptHardwareRecovery = (stuckPos) => {
    if (audioCtx) {
        audioCtx.suspend().then(() => audioCtx.resume()).catch(() => {});
    }
    
    if (isWebAudioMode) {
        if (mseActive && msePlayer) {
            msePlayer.load(); 
            msePlayer.currentTime = stuckPos;
            const p = msePlayer.play(); if (p) p.catch(()=>{});
        } else if (currentBuffer) {
            pauseOffset = stuckPos;
            stopWebAudio(); 
            playWebAudio();
        }
    } else if (html5ActivePlayer) {
        html5ActivePlayer.load();
        html5ActivePlayer.currentTime = stuckPos;
        const p = html5ActivePlayer.play(); if (p) p.catch(()=>{});
    }
    
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
    if (stuckPos === 0 && isIOS) {
        window.dispatchEvent(new CustomEvent('ios-hardware-deadlock'));
    }
};

// ─── Engine bootstrap ─────────────────────────────────────────────────────────

export const unlockAudioContext = () => {
    if (hasDoneSilentPrime) return;
    hasDoneSilentPrime = true;

    const Ctor = window.AudioContext || window['webkitAudioContext'];
    if (!audioCtx) audioCtx = new Ctor();

    initSilentPlayer();
    initMsePlayer();

    let interruptionPolling = null;

    audioCtx.onstatechange = () => {
        const s = audioCtx.state;
        if ((s === 'interrupted' || s === 'suspended') && get(isPlaying)) {
            // FIX 1: Instant resume instead of waiting 1000ms. Restores the 10ms gap.
            audioCtx.resume().then(() => {
                if (isWebAudioMode && currentBuffer && activeSources.size === 0 && !mseActive) playWebAudio();
                else if (mseActive && msePlayer?.paused) { const p = msePlayer.play(); if(p) p.catch(()=>{}); }
                else if (!isWebAudioMode && html5ActivePlayer?.paused) { const p = html5ActivePlayer.play(); if(p) p.catch(()=>{}); }
            }).catch(() => {
                // Only fall back to polling if the instant resume fails
                if (!interruptionPolling) {
                    interruptionPolling = setInterval(() => {
                        if (audioCtx.state === 'running' || !get(isPlaying)) {
                            clearInterval(interruptionPolling);
                            interruptionPolling = null;
                        } else {
                            audioCtx.resume().catch(() => {});
                        }
                    }, 100); // Sped up fallback polling to 100ms
                }
            });
        } else if (s === 'running') {
            if (interruptionPolling) { clearInterval(interruptionPolling); interruptionPolling = null; }
            if (get(isPlaying)) {
                if (html5ActivePlayer?.paused && !mseActive) {
                    const p = html5ActivePlayer.play(); if (p) p.catch(() => {});
                }
                if (isWebAudioMode && currentBuffer && activeSources.size === 0 && !mseActive) {
                    playWebAudio();
                }
            }
        }
    };

    buildWebAudioGraph();
    tryWireAudioNodes();

    if (msePlayer) {
        msePlayer.src = SILENCE_B64;
        const p = msePlayer.play(); if (p) p.catch(() => {});
        msePlayer.pause();
        msePlayer.removeAttribute('src');
    }

    if (playerA && playerB) {
        for (const el of [playerA, playerB]) {
            el.src = SILENCE_B64;
            const p = el.play(); if (p) p.catch(() => {});
            el.pause();
        }
    }

    if (isWebAudioMode) {
        if (silentPlayer) {
            const p = silentPlayer.play();
            if (p) p.then(() => { if (!get(isPlaying)) silentPlayer.pause(); }).catch(() => {});
        }
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || !audioCtx) return;
            
            // FIX 2: Removed the forced `audioCtx.suspend()` here which was causing 
            // a heavy stutter whenever the user reopened the app from the background.

            if (audioCtx.state !== 'running') {
                audioCtx.resume().then(() => {
                    if (get(isPlaying)) {
                        if (isWebAudioMode) {
                            if (mseActive && msePlayer?.paused) {
                                const p = msePlayer.play(); if (p) p.catch(() => {});
                            } else if (currentBuffer && activeSources.size === 0) {
                                playWebAudio();
                            }
                        } else if (!isWebAudioMode && html5ActivePlayer?.paused) {
                            const p = html5ActivePlayer.play(); if (p) p.catch(() => {});
                        }
                    }
                }).catch(() => {});
            }
        }, { passive: true });

        window.addEventListener('pageshow', (e) => {
            if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
        }, { passive: true });

        window.addEventListener('resume', () => {
            if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
        }, { passive: true });
    }

    isEngineInitialized = true;
};

export const registerAudioElements = (elA, elB) => {
    playerA            = elA;
    playerB            = elB;
    html5ActivePlayer  = playerA;
    html5StandbyPlayer = playerB;

    tryWireAudioNodes();

    // Always set up HTML5 event listeners regardless of mode.
    // These elements are always present as fallback, and if the user
    // toggles gapless off, these listeners must already exist.
    const setup = (el) => {
        el.addEventListener('error', () => {
            if (el === html5ActivePlayer && !el.src.startsWith('data:')) {
                isBuffering.set(false);
                stopBufferSound();
                isPlaying.set(false);
                window.dispatchEvent(new CustomEvent('track-load-error'));
                console.error('HTML5 Player Network/Decode Error', el.error);
            }
        });

        el.addEventListener('loadedmetadata', () => {
            if (el !== html5ActivePlayer) return;
            playerDuration.set(el.duration);
            updateMediaPositionState(el.currentTime, el.duration);
        }, { passive: true });

        el.addEventListener('timeupdate', () => {
            if (el !== html5ActivePlayer || el.duration <= 0) return;
            playerCurrentTime.set(el.currentTime);
            if (!el._earlyEndFired && el.duration - el.currentTime <= 0.15) {
                el._earlyEndFired = true;
                window.dispatchEvent(new CustomEvent('track-ended'));
            }
        }, { passive: true });

        // Safety net: if the early-end check in timeupdate misses
        // (e.g. large timeupdate gaps on iOS), catch the native ended event.
        el.addEventListener('ended', () => {
            if (el === html5ActivePlayer && !el._earlyEndFired) {
                el._earlyEndFired = true;
                window.dispatchEvent(new CustomEvent('track-ended'));
            }
        }, { passive: true });

        el.addEventListener('play', () => {
            el._earlyEndFired = false;
            clearTimeout(stallTimeout);
            stallTimeout = setTimeout(() => checkDeadlock(el), 3500);
            if (el === html5ActivePlayer) {
                isPlaying.set(true);
                // Update iOS widget: mark as playing with current position
                if (!isWebAudioMode && el.duration > 0) {
                    updateMediaPositionState(el.currentTime, el.duration);
                }
            }
        });

        el.addEventListener('waiting', () => {
            if (el === html5ActivePlayer) { isBuffering.set(true); startBufferSound(); }
        }, { passive: true });

        el.addEventListener('playing', () => {
            if (el === html5ActivePlayer) {
                isBuffering.set(false); stopBufferSound(); isPlaying.set(true);
                // Update iOS widget: confirm playback is active
                if (!isWebAudioMode && el.duration > 0) {
                    updateMediaPositionState(el.currentTime, el.duration);
                }
            }
            clearTimeout(stallTimeout);
        }, { passive: true });

        el.addEventListener('pause', () => {
            if (el === html5ActivePlayer) {
                isPlaying.set(false);
                // Update iOS widget: mark as paused so widget stays visible
                if (!isWebAudioMode && el.duration > 0) {
                    updateMediaPositionState(el.currentTime, el.duration);
                }
            }
            clearTimeout(stallTimeout);
        }, { passive: true });
    };

    setup(playerA);
    setup(playerB);
};

const checkDeadlock = (el) => {
    const ctxStuck   = audioCtx && audioCtx.state !== 'running';
    const headStuck  = !el.paused && el.readyState >= 3 && el.currentTime < 0.1;
    if (ctxStuck || headStuck) {
        clearTimeout(stallTimeout);
        attemptHardwareRecovery(el.currentTime);
    }
};

export const preloadNextUrl = async (url) => {
    if (isWebAudioMode) {
        if (url === currentTrackUrl) return;
        fetchAndDecode(url);
    } else {
        const target    = html5StandbyPlayer;
        const streamUrl = buildStreamUrl(url, false);
        if (!target || srcMatchesUrl(target.src, url)) return;

        target.src     = streamUrl;
        target.preload = 'auto';

        const tGain = target === playerA ? gainA : gainB;
        if (tGain && audioCtx) {
            tGain.gain.cancelScheduledValues(audioCtx.currentTime);
            tGain.gain.value = 0;
        }
        target.load();

        const p = target.play();
        if (p) {
            p.then(() => {
                const onReady = () => {
                    try { target.pause(); target.currentTime = 0; } catch {}
                    target.removeEventListener('canplaythrough', onReady);
                };
                target.addEventListener('canplaythrough', onReady, { once: true });
                setTimeout(onReady, 1500); 
            }).catch(() => {});
        }
    }
};

export const loadAndPlayUrl = async (url) => {
    const streamUrl     = buildStreamUrl(url, false);
    const currentLoadId = ++pendingLoadId;

    if (!isEngineInitialized) unlockAudioContext();
    if (audioCtx?.state === 'suspended') await audioCtx.resume().catch(() => {});

    // Always tear down MSE when loading a new track, regardless of mode.
    // Prevents stale MSE state from interfering with HTML5 playback.
    if (mseActive) teardownMse();

    if (html5StandbyPlayer && srcMatchesUrl(html5StandbyPlayer.src, url)) {
        [html5ActivePlayer, html5StandbyPlayer] = [html5StandbyPlayer, html5ActivePlayer];
    } else if (html5ActivePlayer && !srcMatchesUrl(html5ActivePlayer.src, url)) {
        [html5ActivePlayer, html5StandbyPlayer] = [html5StandbyPlayer, html5ActivePlayer];
        html5ActivePlayer.src = streamUrl;
        html5ActivePlayer.load();
    }

    const activeGain  = html5ActivePlayer === playerA ? gainA : gainB;
    const standbyGain = html5StandbyPlayer === playerA ? gainA : gainB;

    if (html5StandbyPlayer) html5StandbyPlayer.pause();
    try { html5ActivePlayer.currentTime = 0; } catch {}

    const startHtml5 = () => {
        const p = html5ActivePlayer?.play();
        if (p) {
            p.then(() => {
                if (isWebAudioMode) stopSilentKeepAlive();
                if (audioCtx && standbyGain) {
                    standbyGain.gain.cancelScheduledValues(audioCtx.currentTime);
                    standbyGain.gain.setValueAtTime(standbyGain.gain.value, audioCtx.currentTime);
                    standbyGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15);
                }
            }).catch(() => { if (isWebAudioMode) startSilentKeepAlive(); });
        }
        if (audioCtx && activeGain) {
            const now    = audioCtx.currentTime;
            const target = isWebAudioMode ? 0.0001 : 1.0;
            activeGain.gain.cancelScheduledValues(now);
            activeGain.gain.setValueAtTime(0, now);
            activeGain.gain.linearRampToValueAtTime(target, now + 0.05);
        }
        if (!isWebAudioMode) {
            isPlaying.set(true);
            startSyntheticClock();
        }
    };
    try { startHtml5(); } catch {}

    if (!isWebAudioMode) return;

    const currentPos      = get(playerCurrentTime);
    const mseRollover     = mseActive && msePlayer && msePlayer.duration > 0 &&
                            (msePlayer.duration - msePlayer.currentTime <= ROLLOVER_THRESHOLD);
    const bufferRollover  = !mseActive && !!currentBuffer &&
                            (currentBuffer.duration - currentPos <= ROLLOVER_THRESHOLD);
    const isNaturalRollover = mseRollover || bufferRollover;

    if (!isNaturalRollover) {
        teardownMse();
        if (currentLoadId === pendingLoadId) stopWebAudio();
        currentBuffer = null;
        isPlaying.set(false);
        isBuffering.set(true);
        startBufferSound();

        const cacheEntry = decodeCache.get(url);
        
        // FIX: If it's cached but NOT fully resolved yet, abort it and prefer MSE fast-start
        if (!cacheEntry || !cacheEntry.resolved) {
            if (cacheEntry && cacheEntry.controller) {
                cacheEntry.controller.abort();
                decodeCache.delete(url);
            }
            const mseDone = await streamViaMse(url, currentLoadId);
            if (currentLoadId !== pendingLoadId) return;
            if (mseDone) return; 
        }
    } else {
        activeSources.forEach(s => { 
            try { 
                s.onended = () => { 
                    try { s.disconnect(); s.buffer = null; } catch {} 
                }; 
            } catch {} 
        });
        activeSources.clear();
        if (syntheticClockInterval) clearInterval(syntheticClockInterval);
        isBuffering.set(true);
    }

    if (!isNaturalRollover) { isBuffering.set(true); startBufferSound(); }

    const buf = await fetchAndDecode(url);

    if (currentLoadId !== pendingLoadId) { stopBufferSound(); return; }

    if (!buf) {
        isBuffering.set(false);
        stopBufferSound();
        html5ActivePlayer?.pause();
        if (!get(isPlaying)) stopSilentKeepAlive();
        window.dispatchEvent(new CustomEvent('track-load-error'));
        return;
    }

    currentTrackUrl = url;

    if (isNaturalRollover) {
        const wasPlayingViaMse = mseActive;
        if (mseActive) {
            teardownMse();
            currentBuffer = null; 
        }
        if (wasPlayingViaMse || get(isPlaying)) {
            isPlaying.set(true); 
            scheduleGaplessNext(buf);
            startSyntheticClock();
        }
    } else {
        currentBuffer = buf;
        playerDuration.set(buf.duration);
        pauseOffset   = 0;
        try { if (html5ActivePlayer) html5ActivePlayer.currentTime = 0; } catch {}
        playWebAudio();
    }

    isBuffering.set(false);
    stopBufferSound();
};

// ─── Playback controls ────────────────────────────────────────────────────────

export const togglePlayGlobal = async () => {
    if (!isEngineInitialized) unlockAudioContext();

    if (isWebAudioMode) {
        if (get(isPlaying)) {
            await playStateCue(true);
            if (mseActive && msePlayer) {
                try { msePlayer.pause(); } catch {}
                isPlaying.set(false);
                if (syntheticClockInterval) clearInterval(syntheticClockInterval);
                const dur = get(playerDuration);
                if (dur > 0) updateMediaPositionState(msePlayer.currentTime, dur);
            } else {
                pauseWebAudio();
            }
        } else {
            await playStateCue(false);
            if (mseActive && msePlayer) {
                if (audioCtx?.state === 'suspended') await audioCtx.resume().catch(() => {});
                const p = msePlayer.play();
                if (p) p.catch(() => startSilentKeepAlive());
                isPlaying.set(true);
                startSyntheticClock();
            } else {
                playWebAudio();
            }
        }
    } else {
        if (!html5ActivePlayer) return;
        if (html5ActivePlayer.paused) {
            await playStateCue(false);
            if (audioCtx?.state === 'suspended') await audioCtx.resume().catch(() => {});
            const aGain = html5ActivePlayer === playerA ? gainA : gainB;
            if (aGain && audioCtx) {
                aGain.gain.cancelScheduledValues(audioCtx.currentTime);
                aGain.gain.value = 1;
            }
            const p = html5ActivePlayer.play(); if (p) p.catch(() => {});
            isPlaying.set(true);
            startSyntheticClock();
            const dur = html5ActivePlayer.duration;
            if (dur > 0) updateMediaPositionState(html5ActivePlayer.currentTime, dur);
        } else {
            await playStateCue(true);
            html5ActivePlayer.pause();
            isPlaying.set(false);
            if (syntheticClockInterval) clearInterval(syntheticClockInterval);
            const dur = html5ActivePlayer.duration;
            if (dur > 0) updateMediaPositionState(html5ActivePlayer.currentTime, dur);
        }
    }
};

// ─── Volume & EQ ──────────────────────────────────────────────────────────────

export const setVolumeBoost = (val) => {
    pendingBoost = parseFloat(val);
    if (gainNode && audioCtx) gainNode.gain.setTargetAtTime(pendingBoost, audioCtx.currentTime, 0.01);
};

export const setEqBand = async (index, val) => {
    pendingEq[index] = parseFloat(val);
    if (eqFilters[index] && audioCtx) {
        if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});
        eqFilters[index].gain.setTargetAtTime(pendingEq[index], audioCtx.currentTime, 0.01);
    }
};

export const setGlobalVolume = (val) => {
    pendingVolume = val / 100;
    if (masterVolumeNode && audioCtx)
        masterVolumeNode.gain.setTargetAtTime(pendingVolume, audioCtx.currentTime, 0.01);
    if (playerA)   playerA.volume   = pendingVolume;
    if (playerB)   playerB.volume   = pendingVolume;
    if (msePlayer) msePlayer.volume = pendingVolume;
};

// ─── Media Session ────────────────────────────────────────────────────────────

export const updateMediaSession = (track, album, handlers) => {
    if (!track || !('mediaSession' in navigator)) return;

    const coverUrl = album?.coverPath
        ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&size=thumb`
        : '';

    navigator.mediaSession.metadata = new MediaMetadata({
        title:   track.title,
        artist:  album?.artistName,
        album:   album?.title,
        artwork: ['96x96','128x128','192x192','256x256','384x384','512x512']
            .map(s => ({ src: coverUrl, sizes: s, type: 'image/jpeg' })),
    });

    navigator.mediaSession.setActionHandler('pause',         async () => handlers.pause());
    navigator.mediaSession.setActionHandler('play',          async () => {
        if (audioCtx?.state === 'suspended') await audioCtx.resume().catch(() => {});
        handlers.play();
    });
    navigator.mediaSession.setActionHandler('previoustrack', handlers.prev);
    navigator.mediaSession.setActionHandler('nexttrack',     handlers.next);

    if (handlers.seek) {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            const t = details.seekTime ?? 0;
            activePlayer.currentTime = t;
            const dur = activePlayer.duration;
            if (!isNaN(dur) && dur > 0) updateMediaPositionState(t, dur);
            handlers.seek(t);
        });
    }
};

export const updateMediaPositionState = (currentTime, duration) => {
    if (!('mediaSession' in navigator) || isNaN(duration) || duration <= 0) return;
    try {
        const playing = get(isPlaying);
        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
        const pos = Math.max(0, Math.min(currentTime, duration));
        navigator.mediaSession.setPositionState({ duration, playbackRate: playing ? 1.0 : 0.0, position: pos });
    } catch {}
};

// ─── Audible cues ─────────────────────────────────────────────────────────────

const makeCueTone = () => {
    if (!audioCtx) return null;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(masterVolumeNode ?? audioCtx.destination);
    return { osc, gain };
};

export const playStateCue = async (isPausing) => {
    if (!audioCtx) return;
    try {
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const { osc, gain } = makeCueTone();
        osc.type = 'sine';
        const now = audioCtx.currentTime;
        osc.frequency.setValueAtTime(isPausing ? 400 : 150, now);
        osc.frequency.exponentialRampToValueAtTime(isPausing ? 150 : 400, now + 0.15);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
    } catch {}
};

export const playSkipCue = async (dir) => {
    if (!audioCtx) return;
    try {
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const { osc, gain } = makeCueTone();
        osc.type = 'sine';
        const now = audioCtx.currentTime;
        osc.frequency.setValueAtTime(dir === 'next' ? 300 : 600, now);
        osc.frequency.exponentialRampToValueAtTime(dir === 'next' ? 600 : 300, now + 0.1);
        gain.gain.setValueAtTime(0.75, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } catch {}
};

// ─── Buffer-loading sound ─────────────────────────────────────────────────────

export const startBufferSound = () => {
    if (!audioCtx || audioCtx.state !== 'running' || bufferOsc) return;

    bufferGain = audioCtx.createGain();
    bufferGain.connect(mixerNode ?? audioCtx.destination);
    bufferGain.gain.value = 0;

    bufferOsc = audioCtx.createOscillator();
    bufferOsc.type = 'sine';
    bufferOsc.connect(bufferGain);
    bufferOsc.start();

    bufferInterval = setInterval(() => {
        if (!bufferOsc || !bufferGain || !audioCtx) return;
        const now = audioCtx.currentTime;
        bufferOsc.frequency.setValueAtTime(196, now);
        bufferOsc.frequency.exponentialRampToValueAtTime(220, now + 1.2);
        bufferGain.gain.cancelScheduledValues(now);
        bufferGain.gain.setValueAtTime(0, now);
        bufferGain.gain.linearRampToValueAtTime(0.04, now + 1.0);
        bufferGain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
    }, 2000);
};

export const stopBufferSound = () => {
    if (bufferInterval) { clearInterval(bufferInterval); bufferInterval = null; }

    const osc  = bufferOsc;
    const gain = bufferGain;
    bufferOsc  = null;
    bufferGain = null;

    if (gain && audioCtx) {
        const now = audioCtx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    }
    setTimeout(() => {
        if (osc)  { try { osc.stop();         } catch {} }
        if (gain) { try { gain.disconnect();  } catch {} }
    }, 600);
};

// ─── Scrub effect ─────────────────────────────────────────────────────────────

export const startScrubEffect = async () => {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {});
    const soundType = typeof window !== 'undefined'
        ? (localStorage.getItem('psyzx_scrub_sound') || 'speed') : 'speed';
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
    if (!audioCtx) return; // FIX: Removed !isWebAudioMode
    const soundType = typeof window !== 'undefined'
        ? (localStorage.getItem('psyzx_scrub_sound') || 'speed') : 'speed';
    if (soundType === 'none') return;

    if (soundType === 'vinyl') {
        const rate = dir > 0 ? Math.min(2.5, 1 + speed * 4) : Math.max(0.2, 1 - speed * 3);
        
        // Scrub WebAudio Buffers
        activeSources.forEach(src => {
            if (src.playbackRate) {
                src.playbackRate.cancelScheduledValues(audioCtx.currentTime);
                src.playbackRate.setTargetAtTime(rate, audioCtx.currentTime, 0.01);
            }
        });
        
        // FIX: Scrub HTML5 Fallback
        if (!isWebAudioMode && html5ActivePlayer) {
            html5ActivePlayer.playbackRate = rate;
        }
        return;
    }

    if (!scrubGain || !scrubOsc) return;

    const targetGain = Math.min(0.4, speed * 1.5);
    scrubGain.gain.cancelScheduledValues(audioCtx.currentTime);
    scrubGain.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.02);

    if (soundType === 'speed' && scrubOsc.frequency) {
        const freq = 100 + speed * 4000 * (dir > 0 ? 1 : 0.8);
        scrubOsc.frequency.cancelScheduledValues(audioCtx.currentTime);
        scrubOsc.frequency.setTargetAtTime(Math.max(100, Math.min(5000, freq)), audioCtx.currentTime, 0.02);
    } else if (soundType === 'beep' && scrubOsc.frequency) {
        scrubOsc.frequency.cancelScheduledValues(audioCtx.currentTime);
        scrubOsc.frequency.setTargetAtTime(dir > 0 ? 800 : 600, audioCtx.currentTime, 0.01);
        scrubGain.gain.setTargetAtTime((Date.now() % 100 < 50) ? targetGain : 0, audioCtx.currentTime, 0.01);
    }
};

export const stopScrubEffect = () => {
    if (!audioCtx) return;
    activeSources.forEach(src => {
        if (src.playbackRate) {
            src.playbackRate.cancelScheduledValues(audioCtx.currentTime);
            src.playbackRate.value = 1.0;
        }
    });
    
    if (!isWebAudioMode && html5ActivePlayer) {
        html5ActivePlayer.playbackRate = 1.0;
    }
    
    if (!scrubGain) return;

    scrubGain.gain.cancelScheduledValues(audioCtx.currentTime);
    scrubGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.01);
    const osc  = scrubOsc;
    const gain = scrubGain;
    scrubOsc  = null;
    scrubGain = null;

    setTimeout(() => {
        if (osc)  { try { osc.stop();        } catch {} }
        if (gain) { try { gain.disconnect(); } catch {} }
    }, 50);
};

// ─── Track navigation ─────────────────────────────────────────────────────────

let lastNextTime = 0;

export const playNextGlobal = async (api, forceManualCue = false) => {
    const now = Date.now();
    if (now - lastNextTime < 500) return;
    lastNextTime = now;

    const playlist = get(currentPlaylist);
    const index    = get(currentIndex);
    const shuffle  = get(isShuffle);
    const repeat   = get(isRepeat);
    const history  = get(shuffleHistory);
    const future   = get(shuffleFuture);
    const queue    = get(userQueue);

    if (!playlist.length) return;

    const currentTime   = get(playerCurrentTime);
    const duration      = get(playerDuration);
    const isAutoAdvance = duration > 0 && (duration - currentTime <= 0.5);

    if (!isAutoAdvance || forceManualCue) playSkipCue('next');

    // Process Explicit Queue 
    if (queue.length > 0) {
        const nextTrack = queue[0];
        userQueue.update(q => q.slice(1));
        
        // Inject into currentPlaylist 
        let targetIndex = index + 1;
        const updatedList = [...playlist];
        updatedList.splice(targetIndex, 0, nextTrack);
        currentPlaylist.set(updatedList);
        
        if (shuffle) {
            shuffleHistory.update(h => [...h, index]);
            shuffleFuture.set([]); // Invalidate forward history when manually queued
        }
        
        currentIndex.set(targetIndex);
        return;
    }

    if (!repeat && index === playlist.length - 1 && queue.length === 0) {
        const newTracks = await api.getRadioMix(playlist[index].id, playlist.map(t => t.id));
        if (newTracks.length) currentPlaylist.update(l => [...l, ...newTracks]);
        else {
            if (isWebAudioMode) pauseWebAudio(); else html5ActivePlayer?.pause();
            return;
        }
    }

    if (shuffle) {
        const updated  = [...history, index];
        shuffleHistory.set(updated);
        
        if (future.length > 0) {
            const nextIdx = future[0];
            shuffleFuture.update(f => f.slice(1));
            currentIndex.set(nextIdx);
        } else {
            const recent   = updated.slice(-Math.floor(playlist.length / 2));
            let unplayed   = Array.from({ length: playlist.length }, (_, i) => i)
                .filter(i => !recent.includes(i) && i !== index);
            if (!unplayed.length) {
                shuffleHistory.set([]);
                unplayed = Array.from({ length: playlist.length }, (_, i) => i).filter(i => i !== index);
            }
            currentIndex.set(unplayed[Math.floor(Math.random() * unplayed.length)]);
        }
    } else {
        currentIndex.set((index + 1) % playlist.length);
    }
};

export const playPrevGlobal = () => {
    const playlist = get(currentPlaylist);
    const index    = get(currentIndex);
    const shuffle  = get(isShuffle);
    const history  = get(shuffleHistory);

    if (!playlist.length) return;

    const currentPos = get(playerCurrentTime);

    if (currentPos > 3) {
        if (isWebAudioMode) seekWebAudio(0);
        else if (html5ActivePlayer) html5ActivePlayer.currentTime = 0;
    } else {
        playSkipCue('prev');
        if (shuffle && history.length > 0) {
            const prev = history[history.length - 1];
            shuffleFuture.update(f => [index, ...f]); // Save memory of where we were
            shuffleHistory.update(h => h.slice(0, -1));
            currentIndex.set(prev);
        } else {
            currentIndex.set((index - 1 + playlist.length) % playlist.length);
        }
    }
};