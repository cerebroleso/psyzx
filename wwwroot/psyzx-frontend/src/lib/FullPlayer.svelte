<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fly, fade } from 'svelte/transition';
    import { currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat, albumsMap, playerCurrentTime, playerDuration, isMaxGlassActive } from '../store.js';
    import { formatTime } from './utils.js';
    import { setEqBand } from './audio.js';
    import { api } from './api.js';
    import { crossfade } from 'svelte/transition';
    import { expoIn, expoOut, quintOut } from 'svelte/easing';
    import { onDestroy } from 'svelte';
    import { tweened } from 'svelte/motion';
    import { spring } from 'svelte/motion';

    let progressRef;
    let currentTimeRef;
    let rafId;

    const frameLoop = () => {
        const audio = getAudioEl();
        if (audio && !isSeekingBar) {
            const current = audio.currentTime || 0;
            const duration = audio.duration || 1;
            const pct = current / duration;

            if (progressRef) progressRef.style.transform = `scaleX(${pct})`;
            if (currentTimeRef) {
                const formatted = formatTime(current);
                if (currentTimeRef.textContent !== formatted) {
                    currentTimeRef.textContent = formatted;
                }
            }
        }
        rafId = requestAnimationFrame(frameLoop);
    };

    onMount(() => {
        rafId = requestAnimationFrame(frameLoop);
    });

    onDestroy(() => {
        if (rafId) cancelAnimationFrame(rafId);
    });

    export let isOpen = false;
    let showQueue = false;

    const [send, receive] = crossfade({
        duration: d => Math.sqrt(d * 100),
        easing: expoOut,
        fallback(node, params) {
            const style = getComputedStyle(node);
            const transform = style.transform === 'none' ? '' : style.transform;
            return {
                duration: 600,
                easing: quintOut,
                css: t => `
                    transform: ${transform} scale(${t});
                    opacity: ${t};
                    filter: blur(${(1 - t) * 8}px);
                `
            };
        }
    });

    const handleClose = () => {
        active = false;
        setTimeout(() => {
            dispatch('close');
        }, 400);
    };

    const handleGlobalKeyDown = (e) => {
        if (e.key === 'Escape' && isLyricsFullScreen) {
            isLyricsFullScreen = false;
        }
    };

    const dispatch = createEventDispatcher();
    const getAudioEl = () => document.querySelector('audio');

    const portal = (node, isEnabled) => {
        let originalParent = node.parentNode;
        const handlePortal = (enabled) => {
            if (enabled) { document.body.appendChild(node); }
            else { if (originalParent) originalParent.appendChild(node); }
        };
        handlePortal(isEnabled);
        return {
            update(newEnabled) { handlePortal(newEnabled); },
            destroy() { if (node.parentNode) node.parentNode.removeChild(node); }
        };
    };

    $: track = $currentPlaylist[$currentIndex];
    $: album = track ? $albumsMap.get(track.albumId) : null;
    $: progressPct = $playerDuration > 0 ? ($playerCurrentTime / $playerDuration) * 100 : 0;
    $: coverUrl = album && album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
    $: hasSyncLyrics = lyrics.length > 0 &&
                   lyrics[0].text !== "◆ LYRICS SYNC NOT AVAILABLE ◆" &&
                   lyrics[0].text !== "♪ (Instrumental / No text) ♪" &&
                   lyrics[0].text !== "♪ (Text not available) ♪";

    // Stiffness 0.15 + Damping 0.8 = "Smooth & Expensive" feel
    // Stiffness 0.1 + Damping 0.5 = "Bouncy & Playful" feel
    let eqMaster = spring(0, {
        stiffness: 0.15,
        damping: 0.8
    });

    let eqBands = spring([0, 0, 0, 0, 0, 0], {
        stiffness: 0.1,
        damping: 0.8
    });

    // Reactively update the audio engine as the spring "settles"
    $: $eqBands.forEach((val, i) => setEqBand(i, val));

        $: $eqBands.forEach((val, i) => setEqBand(i, val));

        const syncMasterEq = () => {
        // Set all bands to the master value simultaneously
        eqBands.set([$eqMaster, $eqMaster, $eqMaster, $eqMaster, $eqMaster, $eqMaster]);
    };

    const applyPreset = (name) => {
        currentPreset = name;
        // The spring will naturally animate this transition
        eqBands.set([...presets[name]]);
    };

    const handleEqChange = (index, event) => {
        currentPreset = 'Custom';
        const val = parseFloat(event.target.value);
        
        // We use .update() but we tell the spring to be "hard" 
        // This makes manual dragging feel 1:1 with your finger/mouse
        eqBands.update(current => {
            current[index] = val;
            return current;
        }, { hard: true }); 
    };

    const presets = {
        'Flat': [0, 0, 0, 0, 0, 0],
        'Full Blast': [12, 12, 12, 6, 12, 12],
        'V-Shape': [5, 2, -2, 1, 4, 6],
        'Bass Boost': [6, 4, 0, 0, 0, 0],
        'Acoustic': [2, 1, 3, 1, 2, 1],
        'Electronic': [5, 3, -1, 2, 4, 5],
        'Vocal Pop': [-1, -1, 3, 4, 2, 0]
    };

    let currentPreset = 'Flat';


    let lyrics = [{ t: 0, text: "♪ (Music) ♪" }];

    $: if (track && track.id && isOpen) {
        if (api && api.getLyrics) {
            api.getLyrics(track.id)
                .then(data => {
                    if (data && data.length > 0) { lyrics = data; }
                    else { lyrics = [{ t: 0, text: "♪ (Instrumental / No text) ♪" }]; }
                })
                .catch(() => { lyrics = [{ t: 0, text: "♪ (Text not available) ♪" }]; });
        }
    }

    $: activeLyricIdx = Math.max(0, lyrics.findIndex((l, i) =>
        $playerCurrentTime >= l.t && (i === lyrics.length - 1 || $playerCurrentTime < lyrics[i+1].t)
    ));

    let lyricsScrollEl;
    let isUserScrolling = false;
    let scrollTimeout;
    let lastScrolledIdx = -1;
    let isLyricsFullScreen = false;

    const handleUserScroll = () => {
        isUserScrolling = true;
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => { isUserScrolling = false; lastScrolledIdx = -1; }, 3000);
    };

    $: if (lyricsScrollEl && activeLyricIdx >= 0 && !isUserScrolling && activeLyricIdx !== lastScrolledIdx) {
        lastScrolledIdx = activeLyricIdx;
        const activeLine = lyricsScrollEl.querySelectorAll('.lyric-line')[activeLyricIdx];
        if (activeLine) {
            lyricsScrollEl.scrollTo({ top: activeLine.offsetTop - lyricsScrollEl.clientHeight / 2 + activeLine.clientHeight / 2, behavior: 'smooth' });
        }
    }

    const togglePlay = () => { const audio = getAudioEl(); if (audio) { audio.paused ? audio.play() : audio.pause(); } };
    const playNext = () => { const audio = getAudioEl(); if (audio) audio.currentTime = audio.duration - 0.1; };
    const playPrev = () => { const audio = getAudioEl(); if (audio) audio.currentTime = 0; };

    const goArtist = () => {
        if (album && album.artistId) {
            handleClose();
            window.location.hash = `#artist/${album.artistId}`;
        }
    };

    let dragY = 0;
    let isDragging = false;
    let startY = 0;
    let active = false;

    $: if (isOpen) {
        setTimeout(() => active = true, 10);
    } else {
        active = false;
        dragY = 0;
    }

    const onTouchStart = (e) => {
        if (isLyricsFullScreen || showQueue) return;
        isDragging = true;
        startY = e.touches[0].clientY;
    };

    const onTouchMove = (e) => {
        if (!isDragging) return;
        const deltaY = e.touches[0].clientY - startY;
        if (deltaY > 0) dragY = deltaY;
    };

    const onTouchEnd = () => {
        if (!isDragging) return;
        isDragging = false;

        if (dragY > 120) {
            handleClose();
        } else {
            dragY = 0;
        }
        startY = 0;
    };

    let progressContainerEl;
    let isSeekingBar = false;

    const onSeekStart = (e) => { isSeekingBar = true; updateSeek(e); };
    const onSeekMove = (e) => { if (!isSeekingBar) return; e.preventDefault(); updateSeek(e); };
    const onSeekEnd = () => { isSeekingBar = false; };

    const updateSeek = (e) => {
        if (!$playerDuration || !progressContainerEl) return;

        const rect = progressContainerEl.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const seekTime = pct * $playerDuration;

        const audioEl = getAudioEl();
        if (audioEl) audioEl.currentTime = seekTime;

        if (progressRef) {
            progressRef.style.transform = `scaleX(${pct})`;
        }
        if (currentTimeRef) {
            currentTimeRef.textContent = formatTime(seekTime);
        }
    };

</script>

<svelte:window
    on:mousemove={onSeekMove}
    on:mouseup={onSeekEnd}
    on:touchmove|nonpassive={onSeekMove}
    on:touchend={onSeekEnd}
    on:keydown={handleGlobalKeyDown}
    on:mousemove={onSeekMove}
/>

{#if isOpen}
<div
    id="full-player"
    class:max-glass={$isMaxGlassActive}
    class:no-scroll={showQueue}
    class:is-dragging={isDragging}
    class:active={active}
    style="transform: translate3d(0, calc({active ? '0px' : '100%'} + {dragY}px), 0);"
>
    <div class="drag-zone" role="presentation" on:touchstart={onTouchStart} on:touchmove|preventDefault|nonpassive={onTouchMove} on:touchend={onTouchEnd}>
        <div class="fp-drag-handle">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
        <div class="fp-header">
            <span class="fp-header-title">NOW PLAYING</span>
            <button class="close-btn" aria-label="Close Full Player" on:click={handleClose}>
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
        </div>
    </div>

    <div class="fp-scroll-content">
        <div class="fp-cover-container">
            {#key coverUrl}
            <img class="sober-cover" src={coverUrl} alt="Big Cover" in:fade={{duration: 200}}>
            {/key}
        </div>

        {#if hasSyncLyrics}
            <div class="lyrics-preview-window" on:click={() => isLyricsFullScreen = true} role="button" tabindex="0">
                <div class="lyrics-preview-strip" style="transform: translate3d(0, calc({-activeLyricIdx} * 24px), 0);">
                    {#each lyrics as line, i}
                        <div class="lp-mini-line" class:active={i === activeLyricIdx}>{line.text}</div>
                    {/each}
                </div>
            </div>
        {:else}
            <div><br></div>
        {/if}

        <div class="fp-info">
            <div class="fp-text-container">
                <div class="fp-title marquee">{track ? track.title : '---'}</div>
                <div class="fp-artist" role="button" tabindex="0" aria-label="Go to Artist" on:click={goArtist} on:keydown={(e) => e.key === 'Enter' && goArtist()}>{album ? album.artistName : '---'}</div>
            </div>
            <button class="btn-icon" aria-label="View Queue" on:click={() => showQueue = true}>
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="6" y="5" width="12" height="6" rx="3" />
                    <line x1="6" y1="15" x2="18" y2="15"></line>
                    <line x1="6" y1="19" x2="18" y2="19"></line>
                </svg>
            </button>
        </div>

        <div class="fp-progress-section">
            <span class="time-label" bind:this={currentTimeRef}>0:00</span>

            <div class="fp-progress-container" bind:this={progressContainerEl} on:mousedown={onSeekStart} on:touchstart|nonpassive={onSeekStart}>
                <div class="fp-progress-track">
                <div class="fp-progress-bar" bind:this={progressRef}></div>
            </div>
        </div>

    <span class="time-label">{formatTime($playerDuration)}</span>
</div>

        <div class="fp-controls">
            <button aria-label="Toggle Shuffle" class="btn-icon" class:active={$isShuffle} on:click={() => isShuffle.set(!$isShuffle)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg>
            </button>
            <button aria-label="Previous Track" class="btn-icon" on:click={playPrev}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" x2="5" y1="19" y2="5"></line></svg>
            </button>
            <button aria-label="Toggle Play" class="fp-btn-main" on:click={togglePlay}>
                {#if $isPlaying}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><rect width="4" height="16" x="6" y="4"></rect><rect width="4" height="16" x="14" y="4"></rect></svg>
                {:else}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                {/if}
            </button>
            <button aria-label="Next Track" class="btn-icon" on:click={playNext}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" x2="19" y1="5" y2="19"></line></svg>
            </button>
            <button aria-label="Toggle Repeat" class="btn-icon" class:active={$isRepeat} on:click={() => isRepeat.set(!$isRepeat)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="m7 22-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path></svg>
            </button>
        </div>

        <div class="fp-sliders">
    <div class="preset-scroll">
        <button class="preset-chip" class:active={currentPreset === 'Custom'} on:click={() => currentPreset = 'Custom'}>Custom</button>
        {#each Object.keys(presets) as p}
            <button class="preset-chip" class:active={currentPreset === p} on:click={() => applyPreset(p)}>{p}</button>
        {/each}
    </div>

    <div class="fp-slider-row">
        <span style="color: var(--accent-color);">ALL</span>
        <input 
            class="sleek-slider" 
            type="range" 
            aria-label="Master EQ" 
            min="-12" max="12" step="0.1" 
            bind:value={$eqMaster} 
            on:input={syncMasterEq} 
            style="--val: {(( $eqMaster + 12) / 24) * 100}%"
        >
    </div>

    <div class="fp-slider-row">
        <span>60</span>
        <input class="sleek-slider" type="range" min="-12" max="12" step="0.1" 
            value={$eqBands[0]} 
            on:input={(e) => handleEqChange(0, e)} 
            style="--val: {(( $eqBands[0] + 12) / 24) * 100}%">
    </div>
    <div class="fp-slider-row">
        <span>250</span>
        <input class="sleek-slider" type="range" min="-12" max="12" step="0.1" 
            value={$eqBands[1]} 
            on:input={(e) => handleEqChange(1, e)} 
            style="--val: {(( $eqBands[1] + 12) / 24) * 100}%">
    </div>
    <div class="fp-slider-row">
        <span>1K</span>
        <input class="sleek-slider" type="range" min="-12" max="12" step="0.1" 
            value={$eqBands[2]} 
            on:input={(e) => handleEqChange(2, e)} 
            style="--val: {(( $eqBands[2] + 12) / 24) * 100}%">
    </div>
    <div class="fp-slider-row">
        <span>4K</span>
        <input class="sleek-slider" type="range" min="-12" max="12" step="0.1" 
            value={$eqBands[3]} 
            on:input={(e) => handleEqChange(3, e)} 
            style="--val: {(( $eqBands[3] + 12) / 24) * 100}%">
    </div>
    <div class="fp-slider-row">
        <span>8K</span>
        <input class="sleek-slider" type="range" min="-12" max="12" step="0.1" 
            value={$eqBands[4]} 
            on:input={(e) => handleEqChange(4, e)} 
            style="--val: {(( $eqBands[4] + 12) / 24) * 100}%">
    </div>
    <div class="fp-slider-row">
        <span>14K</span>
        <input class="sleek-slider" type="range" min="-12" max="12" step="0.1" 
            value={$eqBands[5]} 
            on:input={(e) => handleEqChange(5, e)} 
            style="--val: {(( $eqBands[5] + 12) / 24) * 100}%">
    </div>
</div>

        <div class="full-lyrics-card">
            <div class="lyrics-header-row">
                <h3>Lyrics</h3>
                <button class="btn-icon" on:click={() => isLyricsFullScreen = true}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
                </button>
            </div>

            <div class="lyrics-scroll-box" bind:this={lyricsScrollEl} on:wheel={handleUserScroll} on:touchmove={handleUserScroll}>
                {#each lyrics as line, i}
                    <div class="lyric-line" class:active={i === activeLyricIdx} on:click={() => { if (getAudioEl()) getAudioEl().currentTime = line.t; }}>
                        {line.text}
                    </div>
                {/each}
            </div>
        </div>
    </div>

    {#if showQueue}
        <div class="queue-modal" in:fly={{y: '100%', duration: 400, easing: expoOut}} out:fly={{y: '100%', duration: 300, easing: quintOut}}>
            <div class="queue-header">
                <h3 style="margin:0; font-size:18px; color:white; font-weight:800; letter-spacing:-0.5px;">Playing Next</h3>
                <button class="btn-icon" on:click={() => showQueue = false}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="queue-list">
                {#each $currentPlaylist as t, i}
                    <div class="queue-item" class:active={i === $currentIndex} role="button" tabindex="0" on:click={() => { currentIndex.set(i); showQueue = false; }}>
                        {#if i === $currentIndex}
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        {:else}
                            <span class="queue-index">{i + 1}</span>
                        {/if}
                        <div class="queue-text">
                            <span class="queue-item-title" style={i === $currentIndex ? 'color: white;' : ''}>{t.title}</span>
                            <span class="queue-item-artist">{$albumsMap.get(t.albumId)?.artistName || 'Unknown Artist'}</span>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>

{#if isLyricsFullScreen}
    <div class="lyrics-modal-popup" use:portal={true} in:fly={{y: '100%', duration: 400, easing: expoOut}} out:fly={{y: '100%', duration: 200, easing: expoIn}}>
        <div class="lyrics-modal-header">
            <h3 style="margin:0; font-size:18px; color:white; font-weight:800; letter-spacing:-0.5px;">Lyrics</h3>
            <button class="btn-icon" on:click={() => isLyricsFullScreen = false}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
        <div class="lyrics-scroll-box popup-version" bind:this={lyricsScrollEl} on:wheel={handleUserScroll} on:touchmove={handleUserScroll}>
            {#each lyrics as line, i}
                <div class="lyric-line" class:active={i === activeLyricIdx} on:click={() => { if (getAudioEl()) getAudioEl().currentTime = line.t; }}>
                    {line.text}
                </div>
            {/each}
        </div>
    </div>
{/if}
{/if}

<style>
    #full-player {
        position: fixed !important;
        top: 64px !important; bottom: 80px !important;
        right: 0 !important; left: auto !important;
        width: 420px !important; max-width: 100vw !important;
        height: calc(100dvh - 144px) !important;
        display: flex !important; flex-direction: column !important;
        z-index: 9990 !important; color: white !important;
        overflow: hidden !important; isolation: isolate !important;

        will-change: transform;
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;

        background: linear-gradient(to bottom, rgba(255,255,255,0.08) 0%, transparent 15%),
                    linear-gradient(to bottom, rgba(0,0,0,0.45), rgba(0,0,0,0.9)),
                    var(--accent-color) !important;
        backdrop-filter: blur(50px) saturate(210%) brightness(1.1) !important;
        -webkit-backdrop-filter: blur(50px) saturate(210%) brightness(1.1) !important;
    }

    #full-player:not(.is-dragging) {
        transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1) !important;
    }

    #full-player.is-dragging {
        transition: none !important;
    }

    @media (max-width: 768px) {
        #full-player {
            top: 0 !important; height: 100dvh !important;
            width: 100vw !important; border-left: none !important;
        }
    }

    #full-player.no-scroll .fp-scroll-content { overflow: hidden !important; }

    #full-player:not(.is-dragging) {
    transition: 
        transform 0.45s cubic-bezier(0.3, 0, 0.1, 1),
        opacity 0.4s ease-in-out,
        backdrop-filter 0.4s ease,
        -webkit-backdrop-filter 0.4s ease !important;
}
    /* When the player is active (visible) */
    #full-player.active {
        opacity: 1 !important;
    }

    /* When the player is NOT active (closing) */
    #full-player:not(.active) {
        opacity: 0 !important;
        backdrop-filter: blur(0px) saturate(100%) brightness(1) !important;
        -webkit-backdrop-filter: blur(0px) saturate(100%) brightness(1) !important;
    }

    .fp-scroll-content {
        width: 100%; flex: 1; overflow-y: auto; overflow-x: hidden;
        padding: 0 24px 32px 24px; box-sizing: border-box;
        scrollbar-width: none; -ms-overflow-style: none;
    }
    .fp-scroll-content::-webkit-scrollbar { display: none; }

    .drag-zone { touch-action: pan-x; flex-shrink: 0; padding: 32px 24px 0 24px; }

    .fp-drag-handle { display: none; }

    .queue-modal {
        position: absolute; inset: 0; z-index: 100000;
        background: rgba(15, 15, 15, 0.95);
        backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
        display: flex; flex-direction: column; border-radius: inherit;
    }
    .queue-header { padding: 32px 24px 16px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .queue-list { flex: 1; overflow-y: auto; padding: 16px 24px 40px 24px; display: flex; flex-direction: column; gap: 4px; }
    .queue-list::-webkit-scrollbar { display: none; }
    .queue-item { display: flex; align-items: center; gap: 16px; padding: 12px; border-radius: 12px; cursor: pointer; transition: background 0.2s; }
    .queue-item:hover { background: rgba(255,255,255,0.05); }
    .queue-item.active { background: rgba(255,255,255,0.08); }
    .queue-index { width: 16px; text-align: center; font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.3); }
    .queue-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .queue-item-title { font-weight: 600; font-size: 15px; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
    .queue-item-artist { font-size: 13px; color: rgba(255,255,255,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .lyrics-modal-popup {
        position: fixed; inset: 0;
        background: rgba(15, 15, 15, 0.95);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        display: flex; flex-direction: column;
        z-index: 999999999;
    }
    .lyrics-modal-header { padding: max(48px, env(safe-area-inset-top)) 24px 16px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); }

    .popup-version { padding: 40px 24px !important; align-items: center; text-align: center; }
    .popup-version .lyric-line { font-size: 24px; margin-bottom: 24px; transform-origin: center; }
    .popup-version .lyric-line.active { font-size: 36px; }

    .lyrics-preview-window {
        height: 72px;
        overflow: hidden;
        position: relative;
        margin-bottom: 16px;
        cursor: pointer;
        -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 35%, black 65%, transparent 100%);
        mask-image: linear-gradient(to bottom, transparent 0%, black 35%, black 65%, transparent 100%);
    }

    .lyrics-preview-strip {
        width: 100%;
        transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
        padding-top: 24px;
    }

    .lp-mini-line {
        height: 24px;
        line-height: 24px;
        text-align: center;
        font-size: 8px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.3);
        transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 0 16px;
    }

    .lp-mini-line.active {
        color: white;
        font-size: 12px;
        font-weight: 800;
        text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
        transform: scale(1.05);
        white-space: pre-wrap;
        word-break: break-word;
        overflow: visible;
    }

    .fp-progress-track { width: 100%; height: 4px !important; background: rgba(255,255,255,0.15) !important; border-radius: 10px !important; position: relative; overflow: hidden; transition: height 0.3s cubic-bezier(0.32, 0.72, 0, 1), background 0.2s !important; transform: translateZ(0); }
    .fp-progress-container:hover .fp-progress-track, .fp-progress-container.seeking .fp-progress-track { height: 40% !important; background: rgba(255,255,255,0.2) !important; }
    .fp-progress-bar {
        height: 100%;
        width: 100% !important;
        background: white !important;
        transform-origin: left;
        will-change: transform;
        transform: translateZ(0) scaleX(0);
        transition: background 0.2s;
    }

    .time-label {
        color: rgba(255,255,255,0.7);
        font-size: 11px;
        width: 42px;
        text-align: center;
        font-variant-numeric: tabular-nums;
        transform: translateZ(0);
        will-change: contents;
    }

    .preset-scroll {
        display: flex; gap: 8px; overflow-x: auto; border-bottom: 1px solid rgba(255,255,255,0.05);
        padding: 8px 14px !important; margin: -8px -4px 12px -4px !important;
        align-items: center;
    }
    .preset-scroll::-webkit-scrollbar { display: none; }
    .preset-chip {
        flex-shrink: 0;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.7);
        padding: 6px 14px; border-radius: 16px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.3s ease;
    }
    .preset-chip.active { background: white !important; color: black !important; border-color: white !important; box-shadow: 0 0 15px rgba(255,255,255,0.4), 0 0 5px rgba(255,255,255,0.2) !important; transform: scale(1.05); }

    .fp-sliders, .full-lyrics-card { background: rgba(255, 255, 255, 0.05) !important; border: 1px solid rgba(255, 255, 255, 0.1) !important; border-radius: 24px !important; backdrop-filter: blur(15px) !important; -webkit-backdrop-filter: blur(15px) !important; }

    #full-player.max-glass { height: calc(100dvh - 210px) !important; top: 76px !important; right: 12px !important; border-radius: 32px !important; border: 1px solid rgba(255, 255, 255, 0.2) !important; box-shadow: 0 25px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1) !important;}

    .fp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; min-height: 28px; }
    .fp-header-title { font-size: 12px; font-weight: 600; letter-spacing: 1px; color: rgba(255,255,255,0.9); }
    .close-btn { background: none; border: none; color: rgba(255,255,255,0.9); cursor: pointer; padding: 8px; border-radius: 50%; transition: background 0.2s; }
    .close-btn:hover { background: rgba(255,255,255,0.1); }

    .fp-cover-container { display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
    .sober-cover { width: 100%; max-width: 350px; aspect-ratio: 1/1; object-fit: cover; border-radius: 12px; box-shadow: 0 15px 40px rgba(0,0,0,0.5); pointer-events: none; }

    .fp-info { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding: 0; }
    .fp-text-container { min-width: 0; flex: 1; display: flex; flex-direction: column; text-align: left; }
    .fp-title { font-size: 20px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: white; margin-bottom: 4px; }
    .fp-artist { font-size: 14px; color: rgba(255,255,255,0.7); cursor: pointer; transition: color 0.2s; }
    .fp-artist:hover { color: white; text-decoration: underline; }

    .fp-progress-section { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .fp-progress-container { flex: 1; height: 24px; display: flex; align-items: center; cursor: pointer; position: relative; }

    .fp-controls { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; padding: 0 16px; }
    .btn-icon { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; transition: color 0.2s; padding: 8px; }
    .btn-icon:hover { color: white; }
    .btn-icon.active { color: white; }

    .fp-btn-main { width: 48px; height: 48px; border-radius: 50%; border: none; background: white; color: black; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.1s; position: relative; z-index: 1; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), 0 0 5px 2px rgba(255, 255, 255, 0.6), 0 0 25px rgba(255, 255, 255, 0.2) !important; transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.3s ease !important; }
    .fp-btn-main:hover { box-shadow: 0 0 20px rgba(255, 255, 255, 0.4), 0 0 10px rgba(255, 255, 255, 0.2), 0 0 4px rgba(255, 255, 255, 0.1) !important; transform: scale(1.08) !important; }
    .fp-btn-main:active { transform: scale(0.96) !important; filter: brightness(0.9); }

    .fp-sliders { padding: 16px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 24px;}

    .fp-slider-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .fp-slider-row:last-child { margin-bottom: 0; }
    .fp-slider-row span { width: 32px; font-size: 11px; text-align: right; color: rgba(255,255,255,0.7); }
    .sleek-slider { -webkit-appearance: none; appearance: none; flex: 1; height: 4px; border-radius: 2px; background: linear-gradient(to right, var(--accent-color) var(--val), rgba(255,255,255,0.15) var(--val)); outline: none; transition: height 0.2s ease; transform: translateZ(0); cursor: grab;}
    .sleek-slider:active {
        cursor: grabbing;
    }

    .sleek-slider::-webkit-slider-thumb {
        /* ... existing thumb code ... */
        /* Add a slight transition for the scale/shadow only */
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
    }

    .sleek-slider::-webkit-slider-thumb:hover {
        transform: scale(1.2);
    }

    .sleek-slider::-webkit-slider-thumb:active {
        transform: scale(0.95); /* "Squishes" when you grab it */
    }
    .sleek-slider:hover { height: 6px; }
    .sleek-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 8px rgba(0,0,0,0.8); transition: transform 0.1s ease; }
    .sleek-slider::-webkit-slider-thumb:hover { transform: scale(1.4); }
    .sleek-slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; border: none; box-shadow: 0 0 8px rgba(0,0,0,0.8); transition: transform 0.1s ease; }
    .sleek-slider::-moz-range-thumb:hover { transform: scale(1.4); }

    .full-lyrics-card { padding: 24px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; flex-shrink: 0; height: 350px; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); }
    .lyrics-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .lyrics-header-row h3 { margin: 0; font-size: 14px; color: var(--accent-color); text-transform: uppercase; letter-spacing: 1px; font-weight: 800; }
    .lyric-line { font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.3); margin-bottom: 16px; transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); transform-origin: left center; cursor: pointer; }
    .lyric-line:hover { color: rgba(255,255,255,0.6); }
    .lyric-line.active { color: white; font-size: 22px; font-weight: 800; text-shadow: 0 0 16px rgba(255,255,255,0.4); }

    .lyrics-scroll-box { flex: 1; overflow-y: auto; padding-right: 8px; display: flex; flex-direction: column; scroll-behavior: smooth; position: relative; scrollbar-width: none; -ms-overflow-style: none;}
    .lyrics-scroll-box::-webkit-scrollbar { display: none; }

    @media (max-width: 768px) {
        #full-player { top: 0 !important; bottom: auto !important; height: 100dvh !important; width: 100vw !important; max-width: 100vw !important; border-left: none !important; z-index: 999999 !important; padding-bottom: max(32px, env(safe-area-inset-bottom)) !important; }
        #full-player.max-glass { top: 12px !important; bottom: 12px !important; left: 12px !important; width: calc(100vw - 24px) !important; height: calc(100dvh - 24px) !important; border-radius: 20px !important; }
        #full-player.max-glass::before { border-radius: 20px !important; }
        .fp-drag-handle { display: flex; width: 100%; justify-content: center; align-items: center; color: rgba(255,255,255,0.4); margin-top: -12px; margin-bottom: 8px; }
        .fp-cover-container { margin-bottom: 24px;}
        .close-btn { display: none; }
        .drag-zone { padding-top: max(32px, env(safe-area-inset-top)); }
    }
</style>