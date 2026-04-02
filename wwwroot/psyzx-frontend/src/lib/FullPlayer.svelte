<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fly, fade } from 'svelte/transition';
    import { currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat, albumsMap, playerCurrentTime, playerDuration, isMaxGlassActive } from '../store.js';
    import { formatTime } from './utils.js';
    import { setEqBand } from './audio.js';
    import { api } from './api.js';
    import { crossfade } from 'svelte/transition';
    import { expoOut, quintOut } from 'svelte/easing';    

    export let isOpen = false;

    const [send, receive] = crossfade({
        // Aumentiamo leggermente il moltiplicatore della durata per dare tempo alla "frenata" di vedersi
        duration: d => Math.sqrt(d * 100), 
        
        // expoOut è la chiave: velocità quasi istantanea all'inizio e decelerazione lunga
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
            if (enabled) {
                document.body.appendChild(node);
            } else {
                if (originalParent) originalParent.appendChild(node);
            }
        };

        handlePortal(isEnabled);

        return {
            update(newEnabled) {
                handlePortal(newEnabled);
            },
            destroy() {
                if (node.parentNode) node.parentNode.removeChild(node);
            }
        };
    };

    $: track = $currentPlaylist[$currentIndex];
    $: album = track ? $albumsMap.get(track.albumId) : null;
    $: progressPct = $playerDuration > 0 ? ($playerCurrentTime / $playerDuration) * 100 : 0;
    $: coverUrl = album && album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';

    let eqMaster = 0; 
    let eqBands = [0, 0, 0, 0, 0, 0];
    
    const syncMasterEq = () => { 
        eqBands = [eqMaster, eqMaster, eqMaster, eqMaster, eqMaster, eqMaster]; 
        eqBands.forEach((val, i) => setEqBand(i, val));
    };
    
    const presets = {
        'Flat': [0, 0, 0, 0, 0, 0],
        'V-Shape': [5, 2, -2, 1, 4, 6],
        'Bass Boost': [6, 4, 0, 0, 0, 0],
        'Acoustic': [2, 1, 3, 1, 2, 1],
        'Electronic': [5, 3, -1, 2, 4, 5],
        'Vocal Pop': [-1, -1, 3, 4, 2, 0]
    };
    
    let currentPreset = 'Flat';

    const applyPreset = (name) => {
        currentPreset = name;
        eqBands = [...presets[name]];
        eqBands.forEach((val, i) => setEqBand(i, val));
    };

    const handleEqChange = (index, event) => {
        currentPreset = 'Custom';
        const val = parseFloat(event.target.value);
        eqBands[index] = val;
        setEqBand(index, val);
    };

    let lyrics = [{ t: 0, text: "♪ (Music) ♪" }];
    
    $: if (track && track.id && isOpen) {
        if (api && api.getLyrics) {
            api.getLyrics(track.id)
                .then(data => {
                    if (data && data.length > 0) {
                        lyrics = data;
                    } else {
                        lyrics = [{ t: 0, text: "♪ (Instrumental / Nessun testo) ♪" }];
                    }
                })
                .catch(() => {
                    lyrics = [{ t: 0, text: "♪ (Testo non disponibile) ♪" }];
                });
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
        scrollTimeout = setTimeout(() => { 
            isUserScrolling = false; 
            lastScrolledIdx = -1; 
        }, 3000);
    };

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

    const togglePlay = () => { const audio = getAudioEl(); if (audio) { audio.paused ? audio.play() : audio.pause(); } };
    const playNext = () => { const audio = getAudioEl(); if (audio) audio.currentTime = audio.duration - 0.1; };
    const playPrev = () => { const audio = getAudioEl(); if (audio) audio.currentTime = 0; };
    
    const goArtist = () => {
        if (album && album.artistId) {
            dispatch('close');
            window.location.hash = `#artist/${album.artistId}`;
        }
    };

    let fpContainer;
    let dragY = 0;
    let isDragging = false;
    let startY = 0;

    const onTouchStart = (e) => {
        if (isLyricsFullScreen) return;
        isDragging = true;
        startY = e.touches[0].clientY;
        if (fpContainer) fpContainer.style.transition = 'none';
    };

    const onTouchMove = (e) => {
        if (!isDragging || !startY || isLyricsFullScreen) return;
        const deltaY = e.touches[0].clientY - startY;
        if (deltaY > 0) {
            if (fpContainer) fpContainer.style.transform = `translateY(${deltaY}px)`;
        }
    };

    const onTouchEnd = (e) => {
        if (!isDragging || !startY || isLyricsFullScreen) return;
        isDragging = false;
        const deltaY = e.changedTouches[0].clientY - startY;
        if (fpContainer) {
            fpContainer.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
            if (deltaY > 120) {
                fpContainer.style.transform = 'translateY(100%)';
                setTimeout(() => dispatch('close'), 300);
            } else {
                fpContainer.style.transform = 'translateY(0)';
            }
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
        const audioEl = getAudioEl();
        if (audioEl) audioEl.currentTime = pct * $playerDuration;
    };
</script>

<svelte:window 
    on:mousemove={onSeekMove} 
    on:mouseup={onSeekEnd} 
    on:touchmove|nonpassive={onSeekMove} 
    on:touchend={onSeekEnd} 
    on:keydown={handleGlobalKeyDown}
/>

{#if isOpen}
<div id="full-player" bind:this={fpContainer} class:max-glass={$isMaxGlassActive} style="transform: translateY({dragY}px); transition: {isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'};" transition:fly={{ y: '100%', duration: 350 }}>
    
    <div class="drag-zone" role="presentation" on:touchstart={onTouchStart} on:touchmove|preventDefault|nonpassive={onTouchMove} on:touchend={onTouchEnd}>
        <div class="fp-drag-handle hide-on-desktop">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
        <div class="fp-header">
            <span class="fp-header-title">NOW PLAYING</span>
            <button class="close-btn" aria-label="Close Full Player" on:click={() => dispatch('close')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
        </div>
        <div class="fp-cover-container">
            {#key coverUrl}
            <img class="sober-cover" src={coverUrl} alt="Big Cover" in:fade={{duration: 200}}>
            {/key}
        </div>
    </div>
    
    <div class="lyrics-preview">
        <div class="lp-text" in:fade={{duration: 150}}>{lyrics[activeLyricIdx]?.text || ''}</div>
    </div>

    <div class="fp-info">
        <div class="fp-title marquee">{track ? track.title : '---'}</div>
        <div class="fp-artist" role="button" tabindex="0" aria-label="Go to Artist" on:click={goArtist} on:keydown={(e) => e.key === 'Enter' && goArtist()}>{album ? album.artistName : '---'}</div>
    </div>

    <div class="fp-progress-section">
        <span class="time-label">{formatTime($playerCurrentTime)}</span>
        
        <div class="fp-progress-container" class:seeking={isSeekingBar} bind:this={progressContainerEl} role="slider" aria-valuenow={progressPct} tabindex="0" on:mousedown={onSeekStart} on:touchstart|nonpassive={onSeekStart}>
            <div class="fp-progress-track">
                <div class="fp-progress-bar" style="width: {progressPct}%;"></div>
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
            {#each Object.keys(presets) as p}
                <button class="preset-chip" class:active={currentPreset === p} on:click={() => applyPreset(p)}>{p}</button>
            {/each}
        </div>

        <div class="fp-slider-row">
            <span style="color: var(--accent-color);">ALL</span>
            <input class="sleek-slider" type="range" aria-label="Master EQ" min="-12" max="12" step="0.1" bind:value={eqMaster} on:input={syncMasterEq} style="--val: {((eqMaster + 12) / 24) * 100}%">
        </div>
        <div class="fp-slider-row"><span>60</span><input class="sleek-slider" type="range" aria-label="EQ 60" min="-12" max="12" step="0.1" value={eqBands[0]} on:input={(e) => handleEqChange(0, e)} style="--val: {((eqBands[0] + 12) / 24) * 100}%"></div>
        <div class="fp-slider-row"><span>250</span><input class="sleek-slider" type="range" aria-label="EQ 250" min="-12" max="12" step="0.1" value={eqBands[1]} on:input={(e) => handleEqChange(1, e)} style="--val: {((eqBands[1] + 12) / 24) * 100}%"></div>
        <div class="fp-slider-row"><span>1K</span><input class="sleek-slider" type="range" aria-label="EQ 1K" min="-12" max="12" step="0.1" value={eqBands[2]} on:input={(e) => handleEqChange(2, e)} style="--val: {((eqBands[2] + 12) / 24) * 100}%"></div>
        <div class="fp-slider-row"><span>4K</span><input class="sleek-slider" type="range" aria-label="EQ 4K" min="-12" max="12" step="0.1" value={eqBands[3]} on:input={(e) => handleEqChange(3, e)} style="--val: {((eqBands[3] + 12) / 24) * 100}%"></div>
        <div class="fp-slider-row"><span>8K</span><input class="sleek-slider" type="range" aria-label="EQ 8K" min="-12" max="12" step="0.1" value={eqBands[4]} on:input={(e) => handleEqChange(4, e)} style="--val: {((eqBands[4] + 12) / 24) * 100}%"></div>
        <div class="fp-slider-row"><span>14K</span><input class="sleek-slider" type="range" aria-label="EQ 14K" min="-12" max="12" step="0.1" value={eqBands[5]} on:input={(e) => handleEqChange(5, e)} style="--val: {((eqBands[5] + 12) / 24) * 100}%"></div>
    </div>

    <div class="full-lyrics-card"> <div class="lyrics-header-row">
        <h3>Lyrics</h3>
        {#if !isLyricsFullScreen}
            <button class="btn-icon" on:click={() => isLyricsFullScreen = true}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
            </button>
        {/if}
    </div>

    {#if !isLyricsFullScreen}
        <div 
            class="lyrics-scroll-box" 
            in:receive={{ key: 'lyrics-box' }}
            out:send={{ key: 'lyrics-box' }}
            bind:this={lyricsScrollEl}
        >
            {#each lyrics as line, i}
                <div class="lyric-line" class:active={i === activeLyricIdx}>
                    {line.text}
                </div>
            {/each}
        </div>
    {/if}
</div>

{#if isLyricsFullScreen}
    <div 
        class="full-lyrics-card is-full-screen" 
        use:portal={true}
        in:receive={{ key: 'lyrics-box' }}
        out:send={{ key: 'lyrics-box', duration: 800 }}
    >
        <div class="lyrics-header-row">
            <h3>Lyrics</h3>
            <button class="btn-icon" on:click={() => isLyricsFullScreen = false}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>
            </button>
        </div>

        <div class="lyrics-scroll-box" bind:this={lyricsScrollEl}>
            {#each lyrics as line, i}
                <div class="lyric-line" class:active={i === activeLyricIdx}>
                    {line.text}
                </div>
            {/each}
        </div>
    </div>
{/if}

    <div class="lyrics-scroll-box" bind:this={lyricsScrollEl} on:wheel={handleUserScroll} on:touchmove={handleUserScroll}>
        {#each lyrics as line, i}
            <div class="lyric-line" 
                 class:active={i === activeLyricIdx} 
                 on:click={() => { if (getAudioEl()) getAudioEl().currentTime = line.t; }}>
                {line.text}
            </div>
        {/each}
    </div>
</div>


{/if}

<style>
    #full-player {
        position: fixed !important; top: 64px !important; bottom: 80px !important; right: 0 !important; left: auto !important;
        width: 420px !important; max-width: 100vw !important; height: auto !important;
        background: linear-gradient(to bottom, rgba(0,0,0,0.5), rgba(0,0,0,0.95)), var(--accent-color) !important;
        backdrop-filter: blur(40px) !important; -webkit-backdrop-filter: blur(40px) !important;
        border-left: 1px solid rgba(255,255,255,0.05) !important; z-index: 9990 !important;
        display: flex !important; flex-direction: column !important;
        padding: 32px 24px !important; box-sizing: border-box !important; color: white !important;
        box-shadow: -10px 0 40px rgba(0,0,0,0.8) !important;
        overflow-y: auto !important; overflow-x: hidden !important; will-change: transform;
    }

    @supports (-moz-appearance:none) {
        #full-player.max-glass { backdrop-filter: blur(24px) !important; background: rgba(255, 255, 255, 0.08) !important; }
        .is-full-screen { backdrop-filter: blur(24px) !important; background: rgba(255, 255, 255, 0.08) !important; }
    }

    #full-player.max-glass {
        border-radius: 24px !important; background: rgba(255, 255, 255, 0.05) !important;
        backdrop-filter: blur(64px) saturate(200%) brightness(1.1) !important;
        -webkit-backdrop-filter: blur(64px) saturate(200%) brightness(1.1) !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        box-shadow: 0 16px 40px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1) !important;
    }

    #full-player.max-glass .fp-sliders, #full-player.max-glass .full-lyrics-card {
        background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 24px; box-shadow: inset 1px 1px 0 rgba(255, 255, 255, 0.2), 0 8px 24px rgba(0,0,0,0.2);
    }

    .drag-zone { touch-action: pan-x; flex-shrink: 0; }
    .hide-on-desktop { display: none; }
    
    .fp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; min-height: 28px; }
    .fp-header-title { font-size: 12px; font-weight: 600; letter-spacing: 1px; color: rgba(255,255,255,0.9); }
    .close-btn { background: none; border: none; color: rgba(255,255,255,0.9); cursor: pointer; padding: 8px; border-radius: 50%; transition: background 0.2s; }
    .close-btn:hover { background: rgba(255,255,255,0.1); }
    
    .fp-cover-container { display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
    .sober-cover { width: 100%; max-width: 350px; aspect-ratio: 1/1; object-fit: cover; border-radius: 8px; box-shadow: 0 12px 36px rgba(0,0,0,0.6); pointer-events: none; }
    
    .lyrics-preview { text-align: center; margin-bottom: 12px; font-size: 15px; font-weight: 700; color: white; text-shadow: 0 0 12px var(--accent-color); height: 24px; overflow: hidden; }

    .fp-info { text-align: left; margin-bottom: 16px; padding: 0; }
    .fp-title { font-size: 20px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: white; margin-bottom: 4px; }
    .fp-artist { font-size: 14px; color: rgba(255,255,255,0.7); cursor: pointer; transition: color 0.2s; }
    .fp-artist:hover { color: white; text-decoration: underline; }
    
    .fp-progress-section { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .time-label { color: rgba(255,255,255,0.7); font-size: 11px; width: 32px; text-align: center; }
    
    .fp-progress-container { flex: 1; height: 24px; display: flex; align-items: center; cursor: pointer; position: relative; }
    .fp-progress-track { width: 100%; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; position: relative; overflow: hidden; transition: height 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), border-radius 0.2s; }
    .fp-progress-container:hover .fp-progress-track, .fp-progress-container.seeking .fp-progress-track { height: 12px; border-radius: 6px; }
    .fp-progress-bar { height: 100%; background: rgba(255,255,255,0.8); transition: width 0.1s linear, background 0.2s; }
    .fp-progress-container:hover .fp-progress-bar, .fp-progress-container.seeking .fp-progress-bar { background: white; }

    .fp-controls { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; padding: 0 16px; }
    .btn-icon { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; transition: color 0.2s; padding: 8px; }
    .btn-icon:hover { color: white; }
    .btn-icon.active { color: white; }
    
    .fp-btn-main { width: 48px; height: 48px; border-radius: 50%; border: none; background: white; color: black; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.1s; }
    .fp-btn-main:hover { transform: scale(1.05); }

    .fp-sliders { padding: 16px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 24px;}
    .preset-scroll { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 16px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .preset-scroll::-webkit-scrollbar { display: none; }
    .preset-chip { background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); padding: 6px 12px; border-radius: 16px; font-size: 11px; font-weight: bold; cursor: pointer; white-space: nowrap; transition: all 0.2s; }
    .preset-chip:hover { background: rgba(255,255,255,0.1); color: white; }
    .preset-chip.active { background: white; color: black; box-shadow: 0 0 12px rgba(255,255,255,0.5); }

    .fp-slider-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .fp-slider-row:last-child { margin-bottom: 0; }
    .fp-slider-row span { width: 32px; font-size: 11px; text-align: right; color: rgba(255,255,255,0.7); }
    
    .sleek-slider { -webkit-appearance: none; appearance: none; flex: 1; height: 4px; border-radius: 2px; background: linear-gradient(to right, var(--accent-color) var(--val), rgba(255,255,255,0.15) var(--val)); outline: none; transition: height 0.2s ease; }
    .sleek-slider:hover { height: 6px; }
    .sleek-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 8px rgba(0,0,0,0.8); transition: transform 0.1s ease; }
    .sleek-slider::-webkit-slider-thumb:hover { transform: scale(1.4); }
    .sleek-slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; border: none; box-shadow: 0 0 8px rgba(0,0,0,0.8); transition: transform 0.1s ease; }
    .sleek-slider::-moz-range-thumb:hover { transform: scale(1.4); }

    .full-lyrics-card { padding: 24px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; flex-shrink: 0; height: 350px; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); }
    
    /* .full-lyrics-card.is-full-screen {
        position: fixed; top: 16px; left: 16px; right: 16px; bottom: 16px; height: auto; z-index: 99999;
        background: rgba(10, 10, 10, 0.85); backdrop-filter: blur(48px) saturate(150%); -webkit-backdrop-filter: blur(48px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.2); box-shadow: 0 32px 64px rgba(0,0,0,0.6);
        border-radius: 24px;
    } */

    .full-lyrics-card.is-full-screen {
        position: fixed !important; /* Diventa un adesivo sullo schermo */
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 999999 !important; /* Più alto di qualsiasi altra cosa */
        background: rgba(0, 0, 0, 0.75) !important; /* Sfondo scuro per leggere meglio */
        padding: 40px !important;
    }

    .lyrics-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .lyrics-header-row h3 { margin: 0; font-size: 14px; color: var(--accent-color); text-transform: uppercase; letter-spacing: 1px; font-weight: 800; }
    
    .lyrics-scroll-box { flex: 1; overflow-y: auto; padding-right: 8px; display: flex; flex-direction: column; scroll-behavior: smooth; }
    .lyrics-scroll-box::-webkit-scrollbar { display: none; }
    
    .lyric-line { font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.3); margin-bottom: 16px; transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); transform-origin: left center; cursor: pointer; }
    .lyric-line:hover { color: rgba(255,255,255,0.6); }
    .lyric-line.active { color: white; font-size: 22px; font-weight: 800; text-shadow: 0 0 16px rgba(255,255,255,0.4); }

    .is-full-screen .lyric-line { font-size: 24px; margin-bottom: 24px; text-align: center; transform-origin: center; }
    .is-full-screen .lyric-line.active { font-size: 36px; }

    @media (max-width: 768px) {
        #full-player { top: 0 !important; bottom: auto !important; height: 100dvh !important; width: 100vw !important; max-width: 100vw !important; border-left: none !important; z-index: 999999 !important; padding-top: max(32px, env(safe-area-inset-top)) !important; padding-bottom: max(32px, env(safe-area-inset-bottom)) !important; }
        #full-player.max-glass { top: 12px !important; bottom: 12px !important; left: 12px !important; width: calc(100vw - 24px) !important; height: calc(100dvh - 24px) !important; border-radius: 20px !important; }
        .full-lyrics-card.is-full-screen { top: 0; left: 0; right: 0; bottom: 0; border-radius: 0; padding-top: max(48px, env(safe-area-inset-top)); }
        .fp-cover-container { margin-top: 24px; margin-bottom: 24px; }
        .hide-on-desktop { display: flex; }
        .fp-drag-handle { width: 100%; justify-content: center; align-items: center; color: rgba(255,255,255,0.4); margin-top: -12px; margin-bottom: 8px; }
        .close-btn { display: none; }
    }

    .lyrics-scroll-box {
        flex: 1;
        overflow-y: auto;
        padding-right: 8px;
        display: flex;
        flex-direction: column;
        scroll-behavior: smooth;
        position: relative; /* <--- FONDAMENTALE: blocca il punto di riferimento qui */
        /* NASCONDI SCROLLBAR PER FIREFOX */
        scrollbar-width: none; 
        /* NASCONDI SCROLLBAR PER IE/EDGE */
        -ms-overflow-style: none; 
    }

    /* NASCONDI SCROLLBAR PER CHROME/SAFARI/OPERA */
    .lyrics-scroll-box::-webkit-scrollbar {
        display: none; 
    }
</style>