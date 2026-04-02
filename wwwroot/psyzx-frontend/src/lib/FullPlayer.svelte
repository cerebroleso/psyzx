<script>
    import { createEventDispatcher } from 'svelte';
    import { fly, fade } from 'svelte/transition';
    import { currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat, albumsMap, playerCurrentTime, playerDuration, isMaxGlassActive } from '../store.js';
    import { formatTime } from './utils.js';

    export let isOpen = false;
    
    const dispatch = createEventDispatcher();
    const getAudioEl = () => document.querySelector('audio');

    $: track = $currentPlaylist[$currentIndex];
    $: album = track ? $albumsMap.get(track.albumId) : null;
    $: progressPct = $playerDuration > 0 ? ($playerCurrentTime / $playerDuration) * 100 : 0;
    $: coverUrl = album && album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';

    let eqMaster = 0; let eqBands = [0, 0, 0, 0, 0, 0];
    const syncMasterEq = () => { eqBands = [eqMaster, eqMaster, eqMaster, eqMaster, eqMaster, eqMaster]; };

    const togglePlay = () => { const audio = getAudioEl(); if (audio) { audio.paused ? audio.play() : audio.pause(); } };
    const playNext = () => { const audio = getAudioEl(); if (audio) audio.currentTime = audio.duration - 0.1; };
    const playPrev = () => { const audio = getAudioEl(); if (audio) audio.currentTime = 0; };
    
    const handleSeek = (e) => {
        if (!$playerDuration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const audioEl = getAudioEl();
        if (audioEl) audioEl.currentTime = ((e.clientX - rect.left) / rect.width) * $playerDuration;
    };

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
        if (dragY > 120) dispatch('close');
        dragY = 0;
        startY = 0;
    };
</script>

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
    
    <div class="fp-info">
        <div class="fp-title marquee">{track ? track.title : '---'}</div>
        <div class="fp-artist" role="button" tabindex="0" aria-label="Go to Artist" on:click={goArtist} on:keydown={(e) => e.key === 'Enter' && goArtist()}>{album ? album.artistName : '---'}</div>
    </div>

    <div class="fp-progress-section">
        <span class="time-label">{formatTime($playerCurrentTime)}</span>
        <div class="fp-progress-container" role="slider" aria-valuenow={progressPct} tabindex="0" on:click={handleSeek} on:keydown={(e) => e.key === 'Enter' && handleSeek(e)}>
            <div class="fp-progress-bar" style="width: {progressPct}%;"></div>
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
        <div class="fp-slider-row">
            <span style="color: var(--accent-color);">ALL</span>
            <input class="sleek-slider" type="range" aria-label="Master EQ" min="-12" max="12" step="0.1" bind:value={eqMaster} on:input={syncMasterEq} style="--val: {((eqMaster + 12) / 24) * 100}%">
        </div>
        <div class="fp-slider-row"><span>60</span><input class="sleek-slider" type="range" aria-label="EQ 60" min="-12" max="12" step="0.1" bind:value={eqBands[0]} style="--val: {((eqBands[0] + 12) / 24) * 100}%"></div>
        <div class="fp-slider-row"><span>250</span><input class="sleek-slider" type="range" aria-label="EQ 250" min="-12" max="12" step="0.1" bind:value={eqBands[1]} style="--val: {((eqBands[1] + 12) / 24) * 100}%"></div>
        <div class="fp-slider-row"><span>1K</span><input class="sleek-slider" type="range" aria-label="EQ 1K" min="-12" max="12" step="0.1" bind:value={eqBands[2]} style="--val: {((eqBands[2] + 12) / 24) * 100}%"></div>
        <div class="fp-slider-row"><span>4K</span><input class="sleek-slider" type="range" aria-label="EQ 4K" min="-12" max="12" step="0.1" bind:value={eqBands[3]} style="--val: {((eqBands[3] + 12) / 24) * 100}%"></div>
        <div class="fp-slider-row"><span>8K</span><input class="sleek-slider" type="range" aria-label="EQ 8K" min="-12" max="12" step="0.1" bind:value={eqBands[4]} style="--val: {((eqBands[4] + 12) / 24) * 100}%"></div>
        <div class="fp-slider-row"><span>14K</span><input class="sleek-slider" type="range" aria-label="EQ 14K" min="-12" max="12" step="0.1" bind:value={eqBands[5]} style="--val: {((eqBands[5] + 12) / 24) * 100}%"></div>
    </div>
</div>
{/if}

<style>
    #full-player {
        position: fixed !important;
        top: 64px !important; bottom: 80px !important; right: 0 !important; left: auto !important;
        width: 420px !important; max-width: 100vw !important; height: auto !important;
        background: linear-gradient(to bottom, rgba(0,0,0,0.5), rgba(0,0,0,0.95)), var(--accent-color) !important;
        backdrop-filter: blur(40px) !important; -webkit-backdrop-filter: blur(40px) !important;
        border-left: 1px solid rgba(255,255,255,0.05) !important; z-index: 9990 !important;
        display: flex !important; flex-direction: column !important;
        padding: 32px 24px !important; box-sizing: border-box !important; color: white !important;
        box-shadow: -10px 0 40px rgba(0,0,0,0.8) !important;
        overflow-y: auto !important; overflow-x: hidden !important;
    }

    #full-player.max-glass {
        border-radius: 24px !important;
        background: rgba(255, 255, 255, 0.05) !important;
        backdrop-filter: blur(64px) saturate(200%) brightness(1.1) !important;
        -webkit-backdrop-filter: blur(64px) saturate(200%) brightness(1.1) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        box-shadow: 0 16px 40px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1) !important;
    }

    #full-player.max-glass .fp-sliders {
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
    .sober-cover { 
        width: 100%; max-width: 350px; aspect-ratio: 1/1; object-fit: cover; border-radius: 8px; 
        box-shadow: 0 12px 36px rgba(0,0,0,0.6); pointer-events: none;
    }
    
    .fp-info, .fp-progress-section, .fp-controls, .fp-sliders { flex-shrink: 0; }

    .fp-info { text-align: left; margin-bottom: 16px; padding: 0; }
    .fp-title { font-size: 20px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: white; margin-bottom: 4px; }
    .fp-artist { font-size: 14px; color: rgba(255,255,255,0.7); cursor: pointer; transition: color 0.2s; }
    .fp-artist:hover { color: white; text-decoration: underline; }
    
    .fp-progress-section { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .time-label { color: rgba(255,255,255,0.7); font-size: 11px; width: 32px; text-align: center; }
    .fp-progress-container { flex: 1; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; cursor: pointer; position: relative; }
    .fp-progress-container:hover .fp-progress-bar { background: white; }
    .fp-progress-bar { height: 100%; border-radius: 2px; background: rgba(255,255,255,0.8); transition: width 0.1s linear, background 0.2s; }

    .fp-controls { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; padding: 0 16px; }
    .btn-icon { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; transition: color 0.2s; padding: 8px; }
    .btn-icon:hover { color: white; }
    .btn-icon.active { color: white; }
    
    .fp-btn-main {
        width: 48px; height: 48px; border-radius: 50%; border: none;
        background: white; color: black; display: flex; align-items: center; justify-content: center; 
        cursor: pointer; transition: transform 0.1s;
    }
    .fp-btn-main:hover { transform: scale(1.05); }

    .fp-sliders { padding: 16px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); }
    .fp-slider-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .fp-slider-row:last-child { margin-bottom: 0; }
    .fp-slider-row span { width: 32px; font-size: 11px; text-align: right; color: rgba(255,255,255,0.7); }
    
    .sleek-slider {
        -webkit-appearance: none; appearance: none; flex: 1; height: 6px; border-radius: 3px;
        background: linear-gradient(to right, var(--accent-color) var(--val), rgba(255,255,255,0.4) var(--val));
        outline: none; transition: height 0.2s ease; box-shadow: inset 0 1px 2px rgba(0,0,0,0.5);
    }
    .sleek-slider:hover { height: 8px; }
    .sleek-slider::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%;
        background: white; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.6); transition: transform 0.1s ease;
    }
    .sleek-slider::-webkit-slider-thumb:hover { transform: scale(1.3); }
    .sleek-slider::-moz-range-thumb {
        width: 16px; height: 16px; border-radius: 50%; background: white; cursor: pointer; border: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.6); transition: transform 0.1s ease;
    }
    .sleek-slider::-moz-range-thumb:hover { transform: scale(1.3); }

    @media (max-width: 768px) {
        #full-player {
            top: 0 !important; bottom: auto !important; height: 100dvh !important;
            width: 100vw !important; max-width: 100vw !important; border-left: none !important;
            z-index: 999999 !important; padding-top: max(32px, env(safe-area-inset-top)) !important;
            padding-bottom: max(32px, env(safe-area-inset-bottom)) !important;
        }
        
        #full-player.max-glass {
            top: 12px !important; bottom: 12px !important; left: 12px !important;
            width: calc(100vw - 24px) !important; height: calc(100dvh - 24px) !important;
            border-radius: 20px !important;
        }

        .fp-cover-container { margin-top: 24px; margin-bottom: 24px; }
        .hide-on-desktop { display: flex; }
        .fp-drag-handle {
            width: 100%; justify-content: center; align-items: center; color: rgba(255,255,255,0.4);
            margin-top: -12px; margin-bottom: 8px;
        }
        .close-btn { display: none; }
    }
</style>