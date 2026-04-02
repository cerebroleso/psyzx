<script>
    import { onMount, createEventDispatcher } from 'svelte';
    import { currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat, shuffleHistory, albumsMap, playerCurrentTime, playerDuration, accentColor, isMaxGlassActive, isDesktopSwapActive } from '../store.js';
    import { initAudioEngine, audioCtx, updateMediaSession, registerAudioElement, setVolumeBoost } from './audio.js';
    import { formatTime } from './utils.js';

    const dispatch = createEventDispatcher();
    let audioEl;
    let volume = 100;
    
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

    onMount(() => {
        registerAudioElement(audioEl);

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

    const togglePlay = () => { if (!track) return; audioEl.paused ? audioEl.play() : audioEl.pause(); };
    
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
    playsinline
    on:timeupdate={handleTimeUpdate} 
    on:loadedmetadata={() => playerDuration.set(audioEl.duration)} 
    on:play={() => {
        isPlaying.set(true);
        const savedBoost = safeGetStorage('psyzx_boost') || '1.0';
        if (parseFloat(savedBoost) > 1.0) setVolumeBoost(savedBoost);
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    }} 
    on:pause={() => {
        isPlaying.set(false);
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    }} 
    on:ended={() => $isRepeat ? audioEl.play() : playNext()}
></audio>

<footer id="player" class:max-glass={$isMaxGlassActive} class:layout-swapped={$isDesktopSwapActive}>
    <div id="progress-wrapper">
        <span id="time-current" class="hide-on-mobile">{formatTime($playerCurrentTime)}</span>
        <div id="progress-container" role="slider" aria-valuenow={progressPct} tabindex="0" on:click={handleSeek} on:keydown={(e) => e.key === 'Enter' && handleSeek(e)}>
            <div id="progress-bar" style="width: {progressPct}%; background: var(--accent-color);"></div>
        </div>
        <span id="time-total" class="hide-on-mobile">{formatTime($playerDuration)}</span>
    </div>

    <div id="player-main">
        <div id="np-info" class="np-info-hover" role="button" tabindex="0" on:click={() => dispatch('openFull')} on:keydown={(e) => e.key === 'Enter' && dispatch('openFull')}>
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
                <input class="sleek-slider" type="range" aria-label="Volume" min="0" max="100" bind:value={volume} style="--val: {volume}%">
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

<style>
    footer#player {
        position: fixed; bottom: 0; left: 0; width: 100vw; height: 80px;
        background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        border-top: 1px solid rgba(255,255,255,0.05); z-index: 10000;
        display: flex; flex-direction: column; padding: 0 24px; box-sizing: border-box;
        transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    
    footer#player.max-glass {
        bottom: 16px !important; left: 16px !important; width: calc(100vw - 32px) !important;
        border-radius: 24px !important; height: auto !important; min-height: 96px !important;
        background: rgba(255, 255, 255, 0.03) !important; 
        backdrop-filter: blur(48px) saturate(200%) brightness(1.1) !important;
        -webkit-backdrop-filter: blur(48px) saturate(200%) brightness(1.1) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important; 
        box-shadow: 0 16px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1) !important;
        padding: 12px 20px !important; flex-direction: column;
    }

    .max-glass #player-main { height: 54px; padding-top: 0; order: 1; }
    
    .max-glass .np-info-hover {
        background: rgba(255, 255, 255, 0.08) !important; backdrop-filter: blur(24px) saturate(150%) !important;
        -webkit-backdrop-filter: blur(24px) saturate(150%) !important; border-radius: 20px !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        box-shadow: inset 1px 1px 0 rgba(255, 255, 255, 0.2), 0 4px 16px rgba(0,0,0,0.1) !important;
        height: 100%; display: flex; align-items: center; padding: 4px 16px 4px 6px !important;
    }

    .max-glass #progress-wrapper {
        display: flex !important; order: 3; width: 100%; margin-top: 14px; margin-bottom: 4px;
    }

    #progress-wrapper { display: flex; align-items: center; gap: 12px; margin-top: -6px; z-index: 2; }
    #time-current, #time-total { font-size: 11px; color: rgba(255,255,255,0.6); font-variant-numeric: tabular-nums; width: 32px; }
    #progress-container { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.2); border-radius: 2px; cursor: pointer; position: relative; }
    #progress-container:hover #progress-bar { background: white !important; }
    #progress-bar { height: 100%; border-radius: 2px; transition: width 0.1s linear, background 0.2s; }
    
    #player-main { display: flex; justify-content: space-between; align-items: center; height: 64px; padding-top: 8px; }
    
    .np-info-hover {
        display: flex; align-items: center; gap: 14px; padding: 6px 8px; border-radius: 8px; cursor: pointer;
        width: 320px; flex-shrink: 0; box-sizing: border-box; margin-left: -8px;
        background: transparent; border: 1px solid transparent; transition: all 0.2s ease;
    }
    .np-info-hover:hover {
        background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.1);
    }
    
    #np-cover { width: 48px; height: 48px; border-radius: 4px; object-fit: cover; }
    #now-playing { display: flex; flex-direction: column; justify-content: center; overflow: hidden; white-space: nowrap; flex: 1; }
    #np-title { font-size: 14px; font-weight: 600; color: white; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
    #np-artist { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; }
    
    #controls { display: flex; align-items: center; justify-content: center; flex: 1; max-width: 400px; }
    #nerdy-info { width: 320px; flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; }
    
    .vol-control { display: flex; align-items: center; gap: 12px; color: rgba(255,255,255,0.7); width: 140px; }
    
    .btn-icon { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; transition: color 0.2s; padding: 8px; }
    .btn-icon:hover { color: white; }
    .btn-icon.active { color: var(--accent-color); text-shadow: 0 0 8px var(--accent-color); }
    .btn-icon-main { 
        width: 40px; height: 40px; border-radius: 50%; border: none; background: white; color: black; display: flex; align-items: center; justify-content: center; 
        cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease; margin: 0 8px; flex-shrink: 0;
    }
    .btn-icon-main:hover { transform: scale(1.08); box-shadow: 0 0 15px var(--accent-color); }
    
    .kbps-badge {
        display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.4); padding: 4px 8px; border-radius: 6px;
        font-size: 11px; font-family: monospace; font-weight: bold; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        letter-spacing: 0.5px; margin-left: 12px;
    }
    .kbps-badge .ext { color: var(--accent-color); }

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

    @media (min-width: 769px) {
        :global(footer#player.layout-swapped #player-main) { flex-direction: row-reverse; }
        :global(footer#player.layout-swapped .np-info-hover) { 
            margin-left: 0; margin-right: -8px; flex-direction: row-reverse; text-align: right; 
        }
        :global(footer#player.layout-swapped .max-glass .np-info-hover) { 
            padding: 4px 6px 4px 16px !important;
        }
        :global(footer#player.layout-swapped #now-playing) { align-items: flex-end; }
        :global(footer#player.layout-swapped #nerdy-info) { justify-content: flex-start; }
    }

    @media (max-width: 768px) {
        .hide-on-mobile { display: none !important; }
        #player-main { justify-content: space-between; }
        .np-info-hover { width: auto; flex: 1; max-width: none; margin-right: 12px; }
        #controls { flex: 0; justify-content: flex-end; max-width: none; }
        
        footer#player.max-glass {
            bottom: 12px !important; left: 12px !important; width: calc(100vw - 24px) !important;
            padding: 12px 16px !important; border-radius: 20px !important;
        }
        .max-glass #player-main { gap: 8px; }
        .max-glass .np-info-hover { padding: 4px 12px 4px 4px !important; }
        .max-glass #progress-wrapper { margin-top: 10px; }
    }
</style>