<script>
    /**
     * @file FullPlayer.svelte
     * @version 2.4.1
     * @description Professional Music Player with optimized Y-axis drawer physics.
     * * FIXED IN THIS VERSION:
     * 1. iOS Background Stack: Bound `isOpen` to toggle the `modal-open` class on document.body for mobile devices.
     * 2. Parallax Drag Physics: Mapped the Svelte drag engine to dynamically reverse the `#app-layout` scale/brightness when dragging down.
     * 3. Seekbar UI: Fixed frameLoop ignoring UI updates during manual finger seek by manually updating the DOM inside updateSeek.
     * 4. Accent Colors: Fixed global CSS overrides hiding the master EQ accent colors and track backgrounds using fallback and !important priorities, and fixed string coercion in Master EQ binding.
     * 5. Preset Chips: Locked active state brightness filter to prevent native iOS tap decay.
     */

    import { createEventDispatcher, onMount, onDestroy, afterUpdate } from 'svelte';
    import { fly, fade } from 'svelte/transition';
    import { 
        currentPlaylist, 
        currentIndex, 
        isPlaying, 
        isShuffle, 
        isRepeat, 
        albumsMap, 
        playerCurrentTime, 
        playerDuration, 
        isMaxGlassActive, 
        appSessionVersion
    } from '../store.js';
    import { formatTime } from './utils.js';
    import { setEqBand } from './audio.js';
    import { api } from './api.js';
    import { quintOut, expoIn, expoOut } from 'svelte/easing';
    import { spring } from 'svelte/motion';

    // -------------------------------------------------------------------------
    // Component Properties
    // -------------------------------------------------------------------------
    export let isOpen = false;
    const dispatch = createEventDispatcher();

    // -------------------------------------------------------------------------
    // Local State Variables
    // -------------------------------------------------------------------------
    let innerWidth = 1000;
    let progressRef;
    let currentTimeRef;
    let playerEl;
    let rafId;
    let showQueue = false;
    let isLyricsFullScreen = false;
    let lyricsScrollEl;
    let isUserScrolling = false;
    let scrollTimeout;
    let lastScrolledIdx = -1;
    let isSeekingBar = false;
    let progressContainerEl;
    let isClosing = false;

    const DEFAULT_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
    const handleImageError = (ev) => {
        ev.target.src = DEFAULT_PLACEHOLDER;
    };

    $: isMobile = innerWidth <= 768;

    // -------------------------------------------------------------------------
    // Drag-to-Dismiss Physics Logic
    // -------------------------------------------------------------------------
    let dragY = 0;
    let isDragging = false;
    let startY = 0;

    /**
     * Resets the drag position whenever the player is toggled.
     * This ensures clean state on every mount.
     */

    $: if (isOpen) {
        isClosing = false; // Reset only when fully opening
    }

    $: if (!isOpen) {
        dragY = 0;
        isDragging = false;
        isClosing = true; // Force the glass kill during the entire Svelte outro
    }

    /**
     * onTouchStart
     * Captures initial Y coordinate. Prevents drag if sub-menus are active.
     */
    const onTouchStart = (e) => {
        if (isLyricsFullScreen || showQueue) return;
        isDragging = true;
        startY = e.touches[0].clientY;
    };

    /**
     * onTouchMove
     * Updates the dragY delta. 
     */
    const onTouchMove = (e) => {
        if (!isDragging) return;
        const currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        
        // We only allow downward movement (deltaY > 0)
        if (deltaY > 0) {
            dragY = deltaY;
        }
    };

    /**
     * onTouchEnd
     * Decides whether to close the player based on velocity/distance.
     */
    const onTouchEnd = () => {
        if (!isDragging) return;
        isDragging = false;

        // 120px is the "Point of No Return" for the drawer closure
        if (dragY > 80) {
            isClosing = true;
            handleClose();
        } else {
            // Snap back to 0 if not dragged far enough
            dragY = 0; 
        }
        startY = 0;
    };

    const handleClose = () => {
        isClosing = true;
        dispatch('close');
        // Resetting here as well for redundant state protection
        dragY = 0; 
    };

    // -------------------------------------------------------------------------
    // iOS Stack Background Physics Integration
    // -------------------------------------------------------------------------
    $: if (typeof document !== 'undefined') {
        if (isOpen && isMobile) {
            // Trigger the App-level CSS transition
            document.body.classList.add('modal-open');
        } else {
            // Safely clear class when closed or resized to desktop
            document.body.classList.remove('modal-open');
        }
    }

    // -------------------------------------------------------------------------
    // Audio Performance Loop (60FPS)
    // -------------------------------------------------------------------------
    const getAudioEl = () => document.querySelector('audio');

    let wasPlayerElPresent = false;

    const frameLoop = () => {
        const audio = getAudioEl();
        if (audio && !isSeekingBar) {
            const current = audio.currentTime || 0;
            const duration = audio.duration || 1;
            const pct = current / duration;

            if (progressRef) {
                progressRef.style.transform = `scaleX(${pct})`;
            }
            if (currentTimeRef) {
                const formatted = formatTime(current);
                if (currentTimeRef.textContent !== formatted) {
                    currentTimeRef.textContent = formatted;
                }
            }
        }

        // Tie Background Scaling to the exact Y bounds of the player component itself
        if (typeof document !== 'undefined') {
            const appLayout = document.getElementById('app-layout');
            if (appLayout) {
                if (playerEl && isMobile) {
                    wasPlayerElPresent = true;
                    const rect = playerEl.getBoundingClientRect();
                    const currentY = Math.max(0, rect.top);
                    const dragProgress = Math.min(1, currentY / (window.innerHeight * 0.8));
                    
                    const scale = 0.93 + (0.07 * dragProgress);
                    const translateY = 10 * (1 - dragProgress);
                    const brightness = 0.6 + (0.4 * dragProgress);
                    
                    appLayout.style.setProperty('transition', 'none', 'important');
                    appLayout.style.setProperty('transform', `scale(${scale}) translateY(${translateY}px)`, 'important');
                    appLayout.style.setProperty('filter', `brightness(${brightness})`, 'important');
                    appLayout.style.setProperty('border-radius', `${32 * (1 - dragProgress)}px`, 'important');
                } else if (wasPlayerElPresent || (!isMobile && appLayout.style.transform)) {
                    // Smoothly release inline styles when component unmounts or resizes
                    wasPlayerElPresent = false;
                    appLayout.style.removeProperty('transition');
                    appLayout.style.removeProperty('transform');
                    appLayout.style.removeProperty('filter');
                    appLayout.style.removeProperty('border-radius');
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
        // Failsafe cleanup
        if (typeof document !== 'undefined') {
            document.body.classList.remove('modal-open');
            const appLayout = document.getElementById('app-layout');
            if (appLayout) {
                appLayout.style.removeProperty('transition');
                appLayout.style.removeProperty('transform');
                appLayout.style.removeProperty('filter');
                appLayout.style.removeProperty('border-radius');
            }
        }
    });

    // -------------------------------------------------------------------------
    // Equalizer & Audio Engine Interaction
    // -------------------------------------------------------------------------
    
    // Smooth spring physics for band transitions
    let eqMaster = spring(0, { stiffness: 0.15, damping: 0.8 });
    let eqBands = spring([0, 0, 0, 0, 0, 0], { stiffness: 0.1, damping: 0.8 });

    // Link Svelte Spring to the Audio Engine
    $: $eqBands.forEach((val, i) => setEqBand(i, val));

    const syncMasterEq = (event) => {
        currentPreset = 'Custom';
        const val = parseFloat(event.target.value);
        eqMaster.set(val, { hard: true });
        eqBands.set([val, val, val, val, val, val], { hard: true });
    };

    const applyPreset = (name) => {
        currentPreset = name;
        eqBands.set([...presets[name]]);
    };

    const handleEqChange = (index, event) => {
        currentPreset = 'Custom';
        const val = parseFloat(event.target.value);
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

    // -------------------------------------------------------------------------
    // Lyrics Processing & Auto-Scroll
    // -------------------------------------------------------------------------
    let lyrics = [{ t: 0, text: "♪ (Music) ♪" }];

    $: if (track && track.id && isOpen) {
        if (api && api.getLyrics) {
            api.getLyrics(track.id)
                .then(data => {
                    if (data && data.length > 0) { lyrics = data; }
                    else { lyrics = [{ t: 0, text: "♪ (Instrumental) ♪" }]; }
                })
                .catch(() => { lyrics = [{ t: 0, text: "♪ (Lyrics Unavailable) ♪" }]; });
        }
    }

    $: activeLyricIdx = Math.max(0, lyrics.findIndex((l, i) =>
        $playerCurrentTime >= l.t && (i === lyrics.length - 1 || $playerCurrentTime < lyrics[i+1].t)
    ));

    $: hasSyncLyrics = lyrics.length > 0 &&
                       lyrics[0].text !== "◆ LYRICS SYNC NOT AVAILABLE ◆" &&
                       lyrics[0].text !== "♪ (Instrumental / No text) ♪" &&
                       lyrics[0].text !== "♪ (Text not available) ♪" &&
                       lyrics[0].text !== "♪ (Instrumental) ♪" &&
                       lyrics[0].text !== "♪ (Music) ♪";

    const handleUserScroll = () => {
        isUserScrolling = true;
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => { isUserScrolling = false; lastScrolledIdx = -1; }, 3000);
    };

    /**
     * Keeps the active lyric centered in the viewport
     */
    $: if (lyricsScrollEl && activeLyricIdx >= 0 && !isUserScrolling && activeLyricIdx !== lastScrolledIdx) {
        lastScrolledIdx = activeLyricIdx;
        const activeLine = lyricsScrollEl.querySelectorAll('.lyric-line')[activeLyricIdx];
        if (activeLine) {
            lyricsScrollEl.scrollTo({ 
                top: activeLine.offsetTop - lyricsScrollEl.clientHeight / 2 + activeLine.clientHeight / 2, 
                behavior: 'smooth' 
            });
        }
    }

    // -------------------------------------------------------------------------
    // Media Playback Controls
    // -------------------------------------------------------------------------
    const togglePlay = () => { 
        const audio = getAudioEl(); 
        if (audio) { audio.paused ? audio.play() : audio.pause(); } 
    };

    const playNext = () => { 
        currentIndex.update(n => (n + 1) % $currentPlaylist.length);
    };

    const playPrev = () => { 
        const audio = getAudioEl(); 
        if (!audio) return;
        if (audio.currentTime > 3) {
            audio.currentTime = 0;
        } else {
            currentIndex.update(n => (n - 1 + $currentPlaylist.length) % $currentPlaylist.length);
        }
    };

    const goArtist = () => {
        if (album && album.artistId) {
            handleClose();
            window.location.hash = `#artist/${album.artistId}`;
        }
    };

    // -------------------------------------------------------------------------
    // Seekbar Logic
    // -------------------------------------------------------------------------
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
        
        // Ensure manual finger drag updates DOM visually since frameLoop ignores updates during isSeekingBar
        if (progressRef) {
            progressRef.style.transform = `scaleX(${pct})`;
        }
        if (currentTimeRef) {
            currentTimeRef.textContent = formatTime(seekTime);
        }
    };

    // -------------------------------------------------------------------------
    // Utilities & Helpers
    // -------------------------------------------------------------------------
    function getDynamicFontSize(text, isActive) {
        if (!isActive) return '10px';
        const containerWidth = 380; 
        const maxFontSize = 24;      
        const minFontSize = 10;        
        const glyphConstant = 0.70;  
        const calculatedSize = containerWidth / (text.length * glyphConstant);
        return `${Math.min(maxFontSize, Math.max(minFontSize, calculatedSize))}px`;
    }

    const handleGlobalKeyDown = (e) => {
        if (e.key === 'Escape') {
            if (isLyricsFullScreen) isLyricsFullScreen = false;
            else if (showQueue) showQueue = false;
            else if (isOpen) handleClose();
        }
    };

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

    // -------------------------------------------------------------------------
    // Mouse Bloom Tracking (Presets)
    // -------------------------------------------------------------------------
    const handlePresetMouseMove = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--m-x', `${e.clientX - rect.left}px`);
        e.currentTarget.style.setProperty('--m-y', `${e.clientY - rect.top}px`);
    };

    // -------------------------------------------------------------------------
    // Core Store Subscriptions (Reactive)
    // -------------------------------------------------------------------------
    $: track = $currentPlaylist[$currentIndex];
    $: album = track ? $albumsMap.get(track.albumId) : null;
    $: coverUrl = (album && album.coverPath) 
        ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&v=${$appSessionVersion}` 
        : DEFAULT_PLACEHOLDER;</script>

<svelte:window
    bind:innerWidth={innerWidth}
    on:mousemove={onSeekMove}
    on:mouseup={onSeekEnd}
    on:touchmove|nonpassive={onSeekMove}
    on:touchend={onSeekEnd}
    on:keydown={handleGlobalKeyDown}
/>

{#if isOpen}
    <div 
        class="player-transition-wrapper" 
        style="position: fixed; inset: 0; z-index: 9990; pointer-events: none;"
        in:fly={{ y: '100%', duration: 550, easing: quintOut, opacity: 1 }}
        out:fly={{ y: '100%', duration: 350, easing: expoIn, opacity: 1 }}
    >
        <div
            id="full-player"
            bind:this={playerEl}
            class:max-glass={$isMaxGlassActive}
            class:no-scroll={showQueue}
            class:is-dragging={isDragging}
            class:is-closing={isClosing}
            style="transform: translate3d(0, {dragY}px, 0); pointer-events: auto;"
        >
            <div 
                class="drag-zone" 
                role="presentation" 
                on:touchstart={onTouchStart} 
                on:touchmove|preventDefault|nonpassive={onTouchMove} 
                on:touchend={onTouchEnd}
            >
                <div class="fp-drag-handle">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div class="fp-header">
                    <span class="fp-header-title">NOW PLAYING</span>
                    <button class="close-btn" aria-label="Close Player" on:click={handleClose}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                </div>
            </div>

            <div class="fp-scroll-content">
                
                <div class="fp-cover-container">
                    {#key coverUrl}
                        <img class= "sober-cover" src={coverUrl}  alt="Album Cover" in:fade={{duration: 250}}
                        on:error={handleImageError}
                        />
                    {/key}
                </div>

                {#if hasSyncLyrics}
                    <div class="lyrics-preview-window" on:click={() => isLyricsFullScreen = true} role="button" tabindex="0">
                        <div class="lyrics-preview-strip" style="transform: translate3d(0, calc({-activeLyricIdx} * 24px), 0);">
                            {#each lyrics as line, i}
                                <div 
                                    class="lp-mini-line" 
                                    class:active={i === activeLyricIdx}
                                    style="font-size: {getDynamicFontSize(line.text, i === activeLyricIdx)}"
                                >
                                    {line.text}
                                </div>
                            {/each}
                        </div>
                    </div>
                {:else}
                    <div class="spacer-vertical"><br></div>
                {/if}

                <div class="fp-info">
                    <div class="fp-text-container">
                        <div class="fp-title marquee">{track ? track.title : '---'}</div>
                        <div 
                            class="fp-artist" 
                            role="button" 
                            tabindex="0" 
                            aria-label="Artist Link" 
                            on:click={goArtist} 
                            on:keydown={(e) => e.key === 'Enter' && goArtist()}
                        >
                            {album ? album.artistName : '---'}
                        </div>
                    </div>
                    <button class="btn-icon" aria-label="Queue" on:click={() => showQueue = true}>
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="6" y="5" width="12" height="6" rx="3" />
                            <line x1="6" y1="15" x2="18" y2="15"></line>
                            <line x1="6" y1="19" x2="18" y2="19"></line>
                        </svg>
                    </button>
                </div>

                <div class="fp-progress-section">
                    <span class="time-label" bind:this={currentTimeRef}>0:00</span>
                    <div 
                        class="fp-progress-container" 
                        bind:this={progressContainerEl} 
                        on:mousedown={onSeekStart} 
                        on:touchstart|nonpassive={onSeekStart}
                    >
                        <div class="fp-progress-track">
                            <div class="fp-progress-bar" bind:this={progressRef}></div>
                        </div>
                    </div>
                    <span class="time-label">{formatTime($playerDuration)}</span>
                </div>

                <div class="fp-controls">
                    <button aria-label="Shuffle" class="btn-icon" class:active={$isShuffle} on:click={() => isShuffle.set(!$isShuffle)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg>
                    </button>
                    <button aria-label="Back" class="btn-icon" on:click={playPrev}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" x2="5" y1="19" y2="5"></line></svg>
                    </button>
                    
                    <button aria-label="Play/Pause" class="fp-btn-main" on:click={togglePlay}>
                        {#if $isPlaying}
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                <rect width="4" height="16" x="7" y="4" rx="1" />
                                <rect width="4" height="16" x="13" y="4" rx="1" />
                            </svg>                        
                        {:else}
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        {/if}
                    </button>

                    <button aria-label="Next" class="btn-icon" on:click={playNext}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" x2="19" y1="5" y2="19"></line></svg>
                    </button>
                    <button aria-label="Repeat" class="btn-icon" class:active={$isRepeat} on:click={() => isRepeat.set(!$isRepeat)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="m7 22-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path></svg>
                    </button>
                </div>

                <div class="fp-sliders">
                    <div class="preset-scroll">
                        <button class="preset-chip" class:active={currentPreset === 'Custom'} on:click={() => currentPreset = 'Custom'} on:mousemove={handlePresetMouseMove}>Custom</button>
                        {#each Object.keys(presets) as p}
                            <button class="preset-chip" class:active={currentPreset === p} on:click={() => applyPreset(p)} on:mousemove={handlePresetMouseMove}>{p}</button>
                        {/each}
                    </div>

                    <div class="fp-slider-row">
                        <span class="label-accent">ALL</span>
                        <input 
                            class="sleek-slider" 
                            type="range" 
                            aria-label="Master EQ" 
                            min="-12" max="12" step="0.1" 
                            value={$eqMaster} 
                            on:input={syncMasterEq} 
                            style="--val: {(( $eqMaster + 12) / 24) * 100}%"
                        >
                    </div>

                    {#each [60, 250, '1K', '4K', '8K', '14K'] as freq, i}
                        <div class="fp-slider-row">
                            <span class="label-freq">{freq}</span>
                            <input class="sleek-slider" type="range" min="-12" max="12" step="0.1" 
                                value={$eqBands[i]} 
                                on:input={(e) => handleEqChange(i, e)} 
                                style="--val: {(( $eqBands[i] + 12) / 24) * 100}%">
                        </div>
                    {/each}
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
                <div class="queue-modal" in:fly={{y: '100%', duration: 400, easing: expoOut}} out:fly={{y: '100%', duration: 300, easing: expoIn}}>
                    <div class="queue-header">
                        <h3 class="queue-title">Playing Next</h3>
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
    </div>

    {#if isLyricsFullScreen}
        <div class="lyrics-modal-popup" use:portal={true} in:fly={{y: '100%', duration: 400, easing: expoOut}} out:fly={{y: '100%', duration: 200, easing: expoIn}}>
            <div class="lyrics-modal-header">
                <h3 class="modal-title">Lyrics</h3>
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
    /* -------------------------------------------------------------------------
    * Layout & Container Physics
    * ------------------------------------------------------------------------- */
    #full-player {
        position: fixed !important;
        /* Desktop Positioning: Account for status bars (64px top / 80px bottom) */
        top: 64px !important; 
        bottom: 80px !important;
        right: 0 !important; 
        left: auto !important; /* Fixing the left offset */
        width: 420px !important; 
        max-width: 100vw !important;
        
        /* Robust height calculation */
        height: calc(100dvh - 144px) !important;
        
        display: flex !important; 
        flex-direction: column !important;
        color: white !important;
        overflow: hidden !important; 
        isolation: isolate !important;

        /* Force hardware composite layer for smooth transforms on iOS */
        will-change: transform;
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;
        
        background: linear-gradient(to bottom, rgba(255,255,255,0.08) 0%, transparent 15%),
                    linear-gradient(to bottom, rgba(0,0,0,0.45), rgba(0,0,0,0.9)),
                    var(--accent-color) !important;
        backdrop-filter: blur(50px) saturate(210%) brightness(1.1) !important;
        -webkit-backdrop-filter: blur(50px) saturate(210%) brightness(1.1) !important;
    }

    /* Instantly kill transitions during drag to allow 1:1 hardware finger tracking */
    #full-player.is-dragging {
        transition: none !important;
    }

    /* Smooth snap-back transition if released without closing */
    #full-player:not(.is-dragging) {
        transition: 
            transform 0.4s cubic-bezier(0.3, 0, 0.1, 1),
            backdrop-filter 0.4s ease,
            -webkit-backdrop-filter 0.4s ease;
    }

    #full-player.is-closing {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background: transparent !important;
        opacity: 0.9;
        transition: none !important;
    }

    /* Instantly drop the heavy GPU filters when dragging or closing */
    #full-player.is-closing,
    #full-player.is-dragging {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        
        /* Fallback to a solid opaque gradient so it doesn't look transparent */
        transition: none !important;
    }

    #full-player.max-glass { 
        height: calc(100dvh - 210px) !important; 
        top: 76px !important; 
        right: 12px !important; 
        border-radius: 32px !important; 
        border: 1px solid rgba(255, 255, 255, 0.2) !important; 
        box-shadow: 0 25px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1) !important;
    }

    /* -------------------------------------------------------------------------
    * Interaction Zones
    * ------------------------------------------------------------------------- */
    .drag-zone { 
        /* CRITICAL: touch-action none prevents iOS rubber-banding while dragging drawer */
        touch-action: none !important; 
        flex-shrink: 0; 
        padding: 32px 24px 0 24px; 
        cursor: grab;
    }
    .drag-zone:active { cursor: grabbing; }

    #full-player.no-scroll .fp-scroll-content { overflow: hidden !important; }

    .fp-scroll-content {
        width: 100%; flex: 1; overflow-y: auto; overflow-x: hidden;
        padding: 0 24px 32px 24px; box-sizing: border-box;
        scrollbar-width: none; -ms-overflow-style: none;
    }
    .fp-scroll-content::-webkit-scrollbar { display: none; }

    .fp-drag-handle { 
        display: none; /* Desktop arrow handle */
        width: 100%;
        justify-content: center;
        align-items: center;
        color: rgba(255, 255, 255, 0.3);
        margin-bottom: 8px;
    }

    /* -------------------------------------------------------------------------
    * Sub-views (Queue & Lyrics Popups)
    * ------------------------------------------------------------------------- */
    .queue-modal {
        position: absolute; inset: 0; z-index: 100000;
        background: rgba(15, 15, 15, 0.95);
        backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
        display: flex; flex-direction: column; border-radius: inherit;
    }
    .queue-header { padding: 32px 24px 16px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .queue-title { margin: 0; font-size: 18px; color: white; font-weight: 800; letter-spacing: -0.5px; }
    
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
    .modal-title { margin: 0; font-size: 18px; color: white; font-weight: 800; letter-spacing: -0.5px; }

    .popup-version { padding: 40px 24px !important; align-items: center; text-align: center; }
    .popup-version .lyric-line { font-size: 24px; margin-bottom: 24px; transform-origin: center; }
    .popup-version .lyric-line.active { font-size: 36px; }

    /* -------------------------------------------------------------------------
    * UI Components (Cover, Lyrics Strip, Controls)
    * ------------------------------------------------------------------------- */
    .lyrics-preview-window {
        height: 72px; overflow: hidden; position: relative;
        margin-bottom: 16px; cursor: pointer;
        -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 35%, black 65%, transparent 100%);
        mask-image: linear-gradient(to bottom, transparent 0%, black 35%, black 65%, transparent 100%);
    }

    .lyrics-preview-strip {
        width: 100%; transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); padding-top: 24px;
    }

    .lp-mini-line {
        height: 24px; line-height: 24px; text-align: center; font-size: 8px; font-weight: 600;
        color: rgba(255, 255, 255, 0.3); transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 16px;
    }

    .lp-mini-line.active {
        color: white; font-weight: 800; text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
        transform: scale(1.05); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .fp-progress-track { 
        width: 100%; height: 4px !important; background: rgba(255,255,255,0.15) !important; 
        border-radius: 10px !important; position: relative; overflow: hidden; 
        transition: height 0.3s cubic-bezier(0.32, 0.72, 0, 1), background 0.2s !important; transform: translateZ(0); 
    }
    .fp-progress-container:hover .fp-progress-track { height: 40% !important; background: rgba(255,255,255,0.2) !important; }
    .fp-progress-bar {
        height: 100%; width: 100% !important; background: white !important;
        transform-origin: left; will-change: transform; transform: translateZ(0) scaleX(0);
        transition: background 0.2s;
    }

    .time-label {
        color: rgba(255,255,255,0.7); font-size: 11px; width: 42px; text-align: center;
        font-variant-numeric: tabular-nums; transform: translateZ(0); will-change: contents;
    }

    /* -------------------------------------------------------------------------
    * Preset Chips with Mouse Bloom 
    * ------------------------------------------------------------------------- */
    .preset-scroll {
        display: flex; gap: 8px; overflow-x: auto; border-bottom: 1px solid rgba(255,255,255,0.05);
        padding: 8px 14px !important; margin: -8px -4px 12px -4px !important; align-items: center;
    }
    .preset-scroll::-webkit-scrollbar { display: none; }
    
    .preset-chip {
        flex-shrink: 0; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); 
        color: rgba(255,255,255,0.7); padding: 6px 14px; border-radius: 16px; font-size: 11px; 
        font-weight: 700; cursor: pointer; 
        position: relative;
        overflow: hidden;
        -webkit-tap-highlight-color: transparent; /* Prevent iOS native gray highlight flash */
        transition: 
            background 0.3s ease, 
            box-shadow 0.3s ease, 
            filter 0.3s ease,
            transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
            color 0.3s ease,
            border-color 0.3s ease;
    }

    /* Mouse Bloom Effect for Preset Chips */
    .preset-chip::after {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: radial-gradient(
            circle at var(--m-x) var(--m-y), 
            rgba(255, 255, 255, 0.25), 
            transparent 70%
        );
        opacity: 0;
        transition: opacity 0.4s ease;
        pointer-events: none;
        z-index: 0;
    }

    .preset-chip:hover::after {
        opacity: 1;
    }

    .preset-chip:hover {
        background: rgba(255, 255, 255, 0.1); 
        border-color: rgba(255, 255, 255, 0.2);
        box-shadow: 0 0 30px rgba(255, 255, 255, 0.1), inset 0 0 10px rgba(255, 255, 255, 0.1);
        filter: brightness(1.2);
    }

    .preset-chip:active {
        transform: scale(0.94) !important;
        filter: brightness(0.9);
        transition: transform 0.1s ease;
    }

    .preset-chip.active { 
        background: white !important; color: black !important; 
        border-color: white !important; box-shadow: 0 0 15px rgba(255,255,255,0.4) !important; transform: scale(1.05) !important; 
        filter: brightness(1) !important; /* Lock brightness to prevent hover interference on tap */
    }
    
    .preset-chip.active::after {
        display: none; /* Hide bloom when actively selected to keep solid white */
    }

    .fp-sliders, .full-lyrics-card {
        background: rgba(255, 255, 255, 0.04) !important; border: 1px solid rgba(255, 255, 255, 0.15) !important;
        border-radius: 28px !important; backdrop-filter: blur(40px) saturate(200%) brightness(1.1) !important;
        -webkit-backdrop-filter: blur(40px) saturate(200%) brightness(1.1) !important;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2) !important;
        transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }

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

    /* --- FP Button Ported CSS --- */
    .fp-btn-main { 
        width: 48px; 
        height: 48px; 
        border-radius: 50%; 
        border: none; 
        background: white; 
        color: black; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        cursor: pointer; 
        position: relative; 
        z-index: 1; 
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), 
                    0 0 5px 2px rgba(255, 255, 255, 0.6), 
                    0 0 25px rgba(255, 255, 255, 0.2) !important; 
        transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), 
                    box-shadow 0.3s ease !important; 
    }

    .fp-btn-main:hover { 
        transform: scale(1.08) !important;
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.4), 
                    0 0 10px rgba(255, 255, 255, 0.2), 
                    0 0 4px rgba(255, 255, 255, 0.1) !important; 
    }

    .fp-btn-main:active { 
        transform: scale(0.96) !important; 
        filter: brightness(0.9); 
    }

    .fp-sliders { padding: 16px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 24px;}

    .fp-slider-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .label-accent { color: var(--accent-color, #ffffff) !important; width: 32px; font-size: 11px; text-align: right; }
    .label-freq { width: 32px; font-size: 11px; text-align: right; color: rgba(255,255,255,0.7); }
    
    .sleek-slider { 
        -webkit-appearance: none; appearance: none; flex: 1; height: 4px; border-radius: 2px; 
        background: linear-gradient(to right, var(--accent-color, #ffffff) var(--val), rgba(255,255,255,0.15) var(--val)) !important; 
        outline: none; transition: height 0.2s ease; transform: translateZ(0); cursor: grab;
    }
    .sleek-slider:active { cursor: grabbing; }

    .sleek-slider::-webkit-slider-thumb {
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
        -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: white; 
        cursor: pointer; box-shadow: 0 0 8px rgba(0,0,0,0.8);
    }
    .sleek-slider::-webkit-slider-thumb:hover { transform: scale(1.4); }
    .sleek-slider::-moz-range-thumb { 
        width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; border: none; box-shadow: 0 0 8px rgba(0,0,0,0.8); 
    }

    .full-lyrics-card { padding: 24px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; flex-shrink: 0; height: 350px; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); }
    .lyrics-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .lyrics-header-row h3 { margin: 0; font-size: 14px; color: var(--accent-color, #ffffff) !important; text-transform: uppercase; letter-spacing: 1px; font-weight: 800; }
    .lyric-line { font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.3); margin-bottom: 16px; transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); transform-origin: left center; cursor: pointer; }
    .lyric-line:hover { color: rgba(255,255,255,0.6); }
    .lyric-line.active { color: white; font-size: 22px; font-weight: 800; text-shadow: 0 0 16px rgba(255,255,255,0.4); }

    .lyrics-scroll-box { flex: 1; overflow-y: auto; padding-right: 8px; display: flex; flex-direction: column; scroll-behavior: smooth; position: relative; scrollbar-width: none; -ms-overflow-style: none;}
    .lyrics-scroll-box::-webkit-scrollbar { display: none; }

    /* -------------------------------------------------------------------------
    * Final Polish & Mobile Tweaks
    * ------------------------------------------------------------------------- */
    @media (max-width: 768px) {
        #full-player { 
            top: 0 !important; 
            bottom: 0 !important; 
            left: 0 !important; 
            right: 0 !important; 
            width: 100% !important; 
            max-width: 100% !important; 
            height: 100% !important; 
            min-height: 100dvh !important; 
            margin: 0 !important;
            border-left: none !important; 
            border-radius: 0 !important;
            z-index: 999999 !important; 
            padding-bottom: max(32px, env(safe-area-inset-bottom)) !important; 
        }
        .fp-drag-handle { display: flex; width: 100%; justify-content: center; align-items: center; color: rgba(255,255,255,0.4); margin-top: -12px; margin-bottom: 8px; }
        .drag-zone { padding-top: max(32px, env(safe-area-inset-top)); }
        .close-btn { display: none; }
    }
</style>