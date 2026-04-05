<script>
    import { onMount, createEventDispatcher } from 'svelte';
    import { currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat, shuffleHistory, albumsMap, playerCurrentTime, playerDuration, accentColor, isMaxGlassActive, isDesktopSwapActive } from '../store.js';
    import { initAudioEngine, audioCtx, updateMediaSession, registerAudioElement, setVolumeBoost, unlockAudioContext } from './audio.js';
    import { formatTime } from './utils.js';

    const dispatch = createEventDispatcher();
    let audioEl;
    let volume = 100;
    let progressBarNode;
    let animationFrameId; 
    
    $: track = $currentPlaylist[$currentIndex];
    $: album = track ? $albumsMap.get(track.albumId) : null;
    $: streamUrl = track ? `/api/Tracks/stream/${track.id}` : '';
    $: coverUrl = album && album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : '';
    $: progressPct = $playerDuration > 0 ? ($playerCurrentTime / $playerDuration) * 100 : 0;
    $: fileExt = track ? track.filePath.split('.').pop().toUpperCase() : 'UNK';
    $: bitrate = track ? track.bitrate : 0;

    $: if (audioEl) audioEl.volume = volume / 100;

    $: if (track && album && audioEl) {
        updateMediaSession(track, album, {
            play: () => audioEl.play(),
            pause: () => audioEl.pause(),
            next: playNext,
            prev: playPrev,
            seekRelative: (offset) => { audioEl.currentTime = Math.max(0, Math.min(audioEl.duration, audioEl.currentTime + offset)); }
        });
    }

    const safeSetStorage = (k, v) => { try { localStorage.setItem(k, v); } catch(e) {} };
    const safeGetStorage = (k) => { try { return localStorage.getItem(k); } catch(e) { return null; } };

    let startY = 0;
    let isSwiping = false;
    let isFullPlayerOpen = false;

    // PROCEDURE: Detect Swipe Up on Mini Player
    const handleTouchStart = (e) => {
        startY = e.touches[0].clientY;
        isSwiping = true;
    };

    const handleTouchMove = (e) => {
        if (!isSwiping) return;
        
        const currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;

        // If swiping UP (negative) more than 60px
        if (deltaY < -60) {
            isSwiping = false; 
            isFullPlayerOpen = true; // Opens the component moved outside
        }
    };

    const handleTouchEnd = () => {
        isSwiping = false;
    };

    const updateAccentColor = async (url) => {
        if (typeof document === 'undefined') return;
        if (!url) { 
            accentColor.set('rgb(181, 52, 209)');
            document.documentElement.style.setProperty('--accent-color', 'rgb(181, 52, 209)'); 
            return; 
        }
        
        try {
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) throw new Error();
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                try {
                    const cvs = document.createElement('canvas'); cvs.width = 1; cvs.height = 1;
                    const ctx = cvs.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, 1, 1);
                    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
                    const boost = Math.max(r, g, b) < 40 ? 50 : 0;
                    const finalColor = `rgb(${r+boost},${g+boost},${b+boost})`;
                    accentColor.set(finalColor);
                    document.documentElement.style.setProperty('--accent-color', finalColor);
                } catch(e) { 
                    accentColor.set('rgb(181, 52, 209)');
                    document.documentElement.style.setProperty('--accent-color', 'rgb(181, 52, 209)'); 
                }
                URL.revokeObjectURL(objUrl);
            };
            img.onerror = () => {
                accentColor.set('rgb(181, 52, 209)');
                document.documentElement.style.setProperty('--accent-color', 'rgb(181, 52, 209)');
            };
            img.src = objUrl;
        } catch (e) {
            accentColor.set('rgb(181, 52, 209)');
            document.documentElement.style.setProperty('--accent-color', 'rgb(181, 52, 209)');
        }
    };

    $: updateAccentColor(coverUrl);

    const handleKeydown = (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const key = e.key ? e.key.toLowerCase() : '';
        switch(key) {
            case ' ': e.preventDefault(); togglePlay(); break;
            case 'l': 
                if (e.shiftKey) playNext(); 
                else if (audioEl) audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + 5); 
                break;
            case 'h': 
                if (e.shiftKey) playPrev(); 
                else if (audioEl) audioEl.currentTime = Math.max(0, audioEl.currentTime - 5); 
                break;
            case 'k': e.preventDefault(); volume = Math.min(100, volume + 5); break;
            case 'j': e.preventDefault(); volume = Math.max(0, volume - 5); break;
        }
    };

    const updateProgressBarLoop = () => {
        if (audioEl && progressBarNode) {
            const current = audioEl.currentTime;
            const total = audioEl.duration || 1; // Prevent division by zero
            const pct = (current / total) * 100;
            
            // Bypass Svelte reactivity and update the DOM directly
            progressBarNode.style.width = `${pct}%`;
        }
        animationFrameId = requestAnimationFrame(updateProgressBarLoop);
    };

    onMount(() => {
        registerAudioElement(audioEl);

        animationFrameId = requestAnimationFrame(updateProgressBarLoop);

        const savedPl = safeGetStorage('psyzx_playlist');
        const savedIdx = safeGetStorage('psyzx_index');
        const savedTime = safeGetStorage('psyzx_time');
        
        if (savedPl && $currentPlaylist.length === 0) {
            try {
                currentPlaylist.set(JSON.parse(savedPl));
                currentIndex.set(parseInt(savedIdx) || 0);
                setTimeout(() => { if (audioEl) audioEl.currentTime = parseFloat(savedTime) || 0; }, 300);
            } catch(e) {}
        }

        return () => {
        // Cleanup loop on destroy
        cancelAnimationFrame(animationFrameId);
    };
    });

    $: if ($currentPlaylist.length > 0) {
        safeSetStorage('psyzx_playlist', JSON.stringify($currentPlaylist));
        safeSetStorage('psyzx_index', $currentIndex.toString());
    }

    let lastSave = 0;
    const handleTimeUpdate = () => {
        playerCurrentTime.set(audioEl.currentTime);
        if (audioEl.currentTime - lastSave > 3 || audioEl.currentTime < lastSave) {
            safeSetStorage('psyzx_time', audioEl.currentTime.toString());
            lastSave = audioEl.currentTime;
        }
    };

    let lastUrl = '';
    $: if (streamUrl && audioEl && streamUrl !== lastUrl) {
        lastUrl = streamUrl;
        audioEl.pause();
        audioEl.src = streamUrl;
        audioEl.load();
        const playPromise = audioEl.play();
        if (playPromise !== undefined) playPromise.catch(e => {});
    }

    const togglePlay = async () => { 
        if (!track) return; 

        // This "wakes up" the Web Audio API on iOS Standalone
        await unlockAudioContext(); 

        if (audioEl.paused) {
            audioEl.play().catch(err => {
                console.error("PWA Playback blocked:", err);
                // Fallback: try to resume context again if playback fails
                if (audioCtx) audioCtx.resume();
            });
        } else {
            audioEl.pause();
        }
    };   

    const playNext = () => {
        if ($currentPlaylist.length === 0) return;
        if ($isShuffle) {
            let unplayed = Array.from({length: $currentPlaylist.length}, (_, i) => i).filter(i => !$shuffleHistory.includes(i) && i !== $currentIndex);
            if (unplayed.length === 0) { 
                shuffleHistory.set([]); 
                unplayed = Array.from({length: $currentPlaylist.length}, (_, i) => i).filter(i => i !== $currentIndex); 
            }
            currentIndex.set(unplayed[Math.floor(Math.random() * unplayed.length)]);
        } else { 
            currentIndex.set(($currentIndex + 1) % $currentPlaylist.length); 
        }
    };
    
    const playPrev = () => {
        if ($currentPlaylist.length === 0) return;
        if ($isShuffle && $shuffleHistory.length > 0) {
            const prevIndex = $shuffleHistory.pop();
            shuffleHistory.set($shuffleHistory);
            currentIndex.set(prevIndex);
        } else { 
            currentIndex.set(($currentIndex - 1 + $currentPlaylist.length) % $currentPlaylist.length); 
        }
    };

    const handleSeek = (e) => {
        if (!$playerDuration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        audioEl.currentTime = ((e.clientX - rect.left) / rect.width) * $playerDuration;
    };
</script>

<svelte:window on:keydown={handleKeydown} />

<audio 
    bind:this={audioEl} 
    crossorigin="anonymous" 
    playsinline
    preload="auto"
    on:timeupdate={handleTimeUpdate} 
    on:loadedmetadata={() => playerDuration.set(audioEl.duration)} 
    on:play={() => {
        isPlaying.set(true);
        // Ensure engine is running
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        
        const savedBoost = safeGetStorage('psyzx_boost') || '1.0';
        if (parseFloat(savedBoost) > 1.0) setVolumeBoost(savedBoost);
        
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }
    }} 
    on:pause={() => {
        isPlaying.set(false);
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }
    }} 
    on:ended={() => $isRepeat ? audioEl.play() : playNext()}
></audio>

<footer 
    id="player" 
    class:max-glass={$isMaxGlassActive} 
    class:layout-swapped={$isDesktopSwapActive}
    on:touchstart|passive={handleTouchStart}
    on:touchmove|passive={handleTouchMove}
    on:touchend|passive={handleTouchEnd}
>
    <div id="progress-wrapper">
        <span id="time-current" class="hide-on-mobile">{formatTime($playerCurrentTime)}</span>
        <div id="progress-container" role="slider" aria-valuenow={progressPct} tabindex="0" on:click={handleSeek}>
            <div id="progress-bar" style="width: {progressPct}%; background: var(--accent-color);"></div>
        </div>
        <span id="time-total" class="hide-on-mobile">{formatTime($playerDuration)}</span>
    </div>

    <div id="player-main">
        <div id="np-info" class="np-info-hover" role="button" tabindex="0" on:click={() => dispatch('toggleFull')}>
            <img id="np-cover" src={coverUrl || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='} alt="Cover">
            <div id="now-playing">
                <div class="np-title-container marquee">
                    <span>{track ? track.title : '---'}</span>
                </div>
                <span id="np-artist">{album ? album.artistName : '---'}</span>
            </div>
        </div>

        <div id="controls">
            <button class="btn-icon hide-on-mobile" class:active={$isShuffle} on:click={() => isShuffle.set(!$isShuffle)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4"/></svg>
            </button>
            <button class="btn-icon hide-on-mobile" on:click={playPrev}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/></svg>
            </button>
            <button class="btn-icon-main" on:click={togglePlay}>
                {#if $isPlaying}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect width="4" height="16" x="6" y="4"/><rect width="4" height="16" x="14" y="4"/></svg>
                {:else}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                {/if}
            </button>
            <button class="btn-icon hide-on-mobile" on:click={playNext}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/></svg>
            </button>
            <button class="btn-icon hide-on-mobile" class:active={$isRepeat} on:click={() => isRepeat.set(!$isRepeat)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3"/></svg>
            </button>
        </div>

        <div id="nerdy-info" class="hide-on-mobile">
            <div class="vol-control">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                <input class="volume-slider" type="range" min="0" max="100" bind:value={volume} style="--val: {volume}%">
            </div>
            {#if bitrate > 0}
            <div class="kbps-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent-color)"><rect x="3" y="8" width="4" height="8"/><rect x="10" y="4" width="4" height="16"/><rect x="17" y="10" width="4" height="4"/></svg>
                <span>{bitrate} kbps</span><span class="ext">{fileExt}</span>
            </div>
            {:else}
                <span style="font-size: 11px; font-family: monospace; color: #555;">NO SIGNAL</span>
            {/if}
        </div>
    </div>
</footer>   

    <div id="player-main">
        <div id="np-info" class="np-info-hover" role="button" tabindex="0" on:click={() => dispatch('toggleFull')} on:keydown={(e) => e.key === 'Enter' && dispatch('toggleFull')}>
            <img id="np-cover" src={coverUrl || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='} alt="Cover">
            <div id="now-playing">
                <span id="np-title">{track ? track.title : '---'}</span>
                <span id="np-artist">{album ? album.artistName : '---'}</span>
            </div>
        </div>

        <div id="controls">
            <button class="btn-icon hide-on-mobile" aria-label="Shuffle" class:active={$isShuffle} on:click={() => isShuffle.set(!$isShuffle)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg>
            </button>
            <button class="btn-icon hide-on-mobile" aria-label="Previous" on:click={playPrev}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" x2="5" y1="19" y2="5"></line></svg>
            </button>
            <button class="btn-icon-main" aria-label="Play/Pause" on:click={togglePlay}>
                {#if $isPlaying}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><rect width="4" height="16" x="6" y="4"></rect><rect width="4" height="16" x="14" y="4"></rect></svg>
                {:else}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                {/if}
            </button>
            <button class="btn-icon hide-on-mobile" aria-label="Next" on:click={playNext}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" x2="19" y1="5" y2="19"></line></svg>
            </button>
            <button class="btn-icon hide-on-mobile" aria-label="Repeat" class:active={$isRepeat} on:click={() => isRepeat.set(!$isRepeat)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="m7 22-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path></svg>
            </button>
        </div>

        <div id="nerdy-info" class="hide-on-mobile">
            <div class="vol-control">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                <input class="volume-slider" type="range" aria-label="Volume" min="0" max="100" bind:value={volume} style="--val: {volume}%">
            </div>
            {#if bitrate > 0}
            <div class="kbps-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent-color)"><rect x="3" y="8" width="4" height="8"/><rect x="10" y="4" width="4" height="16"/><rect x="17" y="10" width="4" height="4"/></svg>
                <span>{bitrate} kbps</span><span class="ext">{fileExt}</span>
            </div>
            {:else}
                <span style="font-size: 11px; font-family: monospace; color: #555;">NO SIGNAL</span>
            {/if}
        </div>
    </div>

<style>
    /* 1. CONTROL CENTER: Edit these values to resize and position everything */
    :root {
        --footer-h: 110px;             /* Standard Height */
        --footer-h-max: 110px;        /* Floating (Max-Glass) Height */
        --footer-w: 98vw;             /* Standard Width */
        --footer-w-max: calc(98vw - 32px); /* Floating Width */
        
        /* BUBBLE DIMENSIONS */
        --np-bubble-w: 320px;         /* Title Bubble Width */
        --np-bubble-h: 60px;          /* Title Bubble Height */

        /* POSITIONING: Adjust X (horizontal) and Y (vertical) in px */
        --np-x: 10px;                  /* Positive = Right, Negative = Left */
        --np-y: -5px;                  /* Positive = Down, Negative = Up */
    }

    /* STRIPPED PARENT CONTAINER */
    footer#player {
        position: fixed; 
        bottom: 0; 
        left: 50%; 
        transform: translateX(-50%); /* Centers the player if width < 100vw */
        width: var(--footer-w); 
        height: var(--footer-h); 
        z-index: 10000;
        display: flex; 
        flex-direction: column; 
        padding: 0 24px; 
        box-sizing: border-box;
        transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
        background: transparent !important; 
        border: none !important; 
        box-shadow: none !important; 
        backdrop-filter: none !important; 
        -webkit-backdrop-filter: none !important;
        /* FIX: Allows the tall bubble to stick out the top */
        overflow: visible !important; 
    }

    /* ISOLATED BACKGROUND LAYER */
    footer#player::before {
        content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; border-radius: inherit;
        background: rgba(0, 0, 0, 0.6); 
        backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        border-top: 1px solid rgba(255,255,255,0.05); 
        transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    
    footer#player.max-glass {
        bottom: 16px !important; 
        left: 50% !important; 
        transform: translateX(-50%) !important;
        width: var(--footer-w-max) !important;
        border-radius: 24px !important; 
        height: var(--footer-h-max) !important; 
        min-height: var(--footer-h-max) !important; 
        padding: 12px 20px !important; 
        flex-direction: column;
    }

    footer#player.max-glass::before {
        background: rgba(255, 255, 255, 0.03) !important; 
        backdrop-filter: blur(32px) saturate(120%) !important; 
        -webkit-backdrop-filter: blur(32px) saturate(120%) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important; 
        box-shadow: 0 16px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1) !important;
    }

    .max-glass #player-main { 
        height: calc(var(--footer-h-max) - 40px); 
        padding-top: 0; 
        order: 1; 
    }
    
    .max-glass .np-info-hover {
        background: rgba(255, 255, 255, 0.08) !important; 
        backdrop-filter: blur(16px) saturate(120%) !important;
        -webkit-backdrop-filter: blur(16px) saturate(120%) !important; 
        border-radius: 20px !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        box-shadow: inset 1px 1px 0 rgba(255, 255, 255, 0.2), 0 4px 16px rgba(0,0,0,0.1) !important;
        display: flex; align-items: center; padding: 4px 16px 4px 6px !important;
    }

    .max-glass #progress-wrapper { display: flex !important; order: 3; width: 100%; margin-top: auto; margin-bottom: 4px; }

    #progress-wrapper { display: flex; align-items: center; gap: 12px; margin-top: -6px; z-index: 2; }
    #time-current, #time-total { font-size: 11px; color: rgba(255,255,255,0.6); font-variant-numeric: tabular-nums; width: 32px; }
    #progress-container { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.2); border-radius: 2px; cursor: pointer; position: relative; }
    #progress-container:hover #progress-bar { background: white !important; }
    #progress-bar { height: 100%; border-radius: 2px; background: rgba(255,255,255,0.8); transition: background 0.2s; }
    
    #player-main { display: flex; justify-content: space-between; align-items: center; height: calc(var(--footer-h) - 16px); padding-top: 8px; }
    
    .np-info-hover {
        display: flex; align-items: center; gap: 14px; padding: 6px 8px; border-radius: 20px !important; cursor: pointer;
        width: var(--np-bubble-w); 
        height: var(--np-bubble-h) !important; 
        flex-shrink: 0; box-sizing: border-box; 
        margin-left: -8px;
        background: transparent; border: 1px solid transparent; 
        
        /* X-Y COORDINATE POSITIONING */
        transform: translate(var(--np-x), var(--np-y)) !important;
        
        /* Added transform to transition for smooth movement tweaks */
        transition: all 0.2s ease, transform 0.4s cubic-bezier(0.32, 0.72, 0, 1);
        justify-content: center;
    }
    .np-info-hover:hover { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.1); }
    
    #np-cover { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; }
    #now-playing { display: flex; flex-direction: column; justify-content: center; overflow: hidden; white-space: nowrap; flex: 1; }
    #np-title { font-size: 12px; font-weight: 600; color: white; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
    #np-artist { font-size: 10px; color: rgba(255,255,255,0.5); overflow: hidden; text-overflow: ellipsis; }
    
    #controls { display: flex; align-items: center; justify-content: center; flex: 1; max-width: 400px; }
    
    /* SYMMETRY: Nerdy info bubble */
    #nerdy-info { 
        width: var(--np-bubble-w); 
        height: var(--np-bubble-h);
        flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; 
    }
    
    .vol-control { display: flex; align-items: center; gap: 12px; color: rgba(255,255,255,0.7); width: 140px; }
    
    .btn-icon { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; transition: color 0.2s; padding: 8px; }
    .btn-icon:hover { color: white; }
    .btn-icon.active { color: var(--accent-color); text-shadow: 0 0 8px var(--accent-color); }

    /* NUKE THE STAIN: Pure black shadows only */
    .btn-icon-main { 
        width: 44px; 
        height: 44px; 
        border-radius: 50%; 
        border: none; 
        background: white; 
        color: black; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        cursor: pointer; 
        margin: 0 8px; 
        flex-shrink: 0;
        position: relative; 
        z-index: 1;
        
        /* The Absolute Fix: No white RGBA values */
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4) !important;
        filter: none !important;
        outline: none !important;
        -webkit-tap-highlight-color: transparent !important;

        transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), 
                    box-shadow 0.3s ease !important;
    }

    .btn-icon-main:hover {
        transform: scale(1.08) !important;
        box-shadow: 0 12px 25px rgba(0, 0, 0, 0.6) !important;
    }

    .btn-icon-main:active {
        transform: scale(0.94) !important;
    }

    .btn-icon-main:hover {
        transform: scale(1.08) !important;
        box-shadow: 0 12px 25px rgba(0, 0, 0, 0.4) !important;    
    }

    .btn-icon-main:active {
        transform: scale(0.94) !important;
        filter: brightness(0.85);
    }
    
    .kbps-badge {
        display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.4); padding: 4px 8px; border-radius: 6px;
        font-size: 11px; font-family: monospace; font-weight: bold; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        letter-spacing: 0.5px; margin-left: 12px;
    }
    .kbps-badge .ext { color: var(--accent-color); }

    .volume-slider {
        -webkit-appearance: none; appearance: none; flex: 1; height: 6px; border-radius: 3px;
        background: linear-gradient(to right, var(--accent-color) var(--val), rgba(255,255,255,0.4) var(--val));
        outline: none; transition: height 0.2s ease; box-shadow: inset 0 1px 2px rgba(0,0,0,0.5);
    }
    .volume-slider:hover { height: 8px; }
    .volume-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.6); transition: transform 0.1s ease; }

    @media (min-width: 769px) {
        :global(footer#player.layout-swapped #player-main) { flex-direction: row-reverse; }
        :global(footer#player.layout-swapped .np-info-hover) { margin-left: 0 !important; margin-right: 0px !important; flex-direction: row-reverse; text-align: right; width: var(--np-bubble-w) !important; padding-right: 20px !important; }
        :global(footer#player.layout-swapped #now-playing) { align-items: flex-end; margin-left: auto; margin-right: 14px; }
        :global(footer#player.layout-swapped #nerdy-info) { justify-content: flex-start; }
    }

    @media (max-width: 768px) {
        .hide-on-mobile { display: none !important; }
        #player-main { justify-content: space-between; }
        .np-info-hover { width: auto; height: 60px !important; flex: 1; max-width: none; margin-right: 12px; }
        #controls { flex: 0; justify-content: flex-end; max-width: none; margin-bottom: 12px;}
        .btn-icon-main {background: rgba(255, 255, 255, 0.15) !important; 
        backdrop-filter: blur(32px) saturate(120%) !important; 
        -webkit-backdrop-filter: blur(32px) saturate(120%) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important; 
        box-shadow: 0 16px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1) !important;
        display: inline-flex;
        padding: 26px;
        }
        
        footer#player.max-glass { 
            bottom: 12px !important; 
            left: 50% !important; 
            transform: translateX(-50%) !important;
            width: calc(100vw - 24px) !important; 
            padding: 12px 16px !important; 
            border-radius: 20px !important; 
            height: auto !important; 
            min-height: 80px !important;
        }
    }
</style>