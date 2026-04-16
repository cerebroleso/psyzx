<script>
    import { onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    import { api } from '../api.js';
    import { currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat, shuffleHistory, isGlobalColorActive, isMaxGlassActive, isLowQualityImages } from '../../store.js';
    import { formatTime } from '../utils.js';

    export let playlistId;

    let playlist = null;
    let tracks = [];
    let isLoading = true;

    $: totalSeconds = tracks.reduce((sum, t) => sum + (t.durationSeconds || 0), 0);
    $: hrs = Math.floor(totalSeconds / 3600);
    $: mins = Math.floor((totalSeconds % 3600) / 60);
    $: timeString = hrs > 0 ? `${hrs} hr ${mins} min` : `${mins} min`;

    $: isPlayingPlaylist = $isPlaying && tracks.length > 0 && ($currentPlaylist?.some(t => tracks.find(pt => pt.id === t.id)) ?? false);

    $: playlistCovers = tracks ? [...new Set(tracks.map(t => t.album?.coverPath).filter(Boolean))].slice(0, 4) : [];

    onMount(async () => {
        if (playlistId) {
            playlist = await api.getPlaylist(playlistId);
            if (playlist && playlist.tracks) {
                tracks = playlist.tracks;
            }
        }
        isLoading = false;
    });

    const togglePlayPlaylist = () => {
        if (tracks.length === 0) return;
        const audio = document.querySelector('audio');
        if (!audio) return;

        if (isPlayingPlaylist) {
            audio.pause();
        } else {
            if ($currentPlaylist?.some(t => tracks.find(pt => pt.id === t.id))) {
                audio.play(); 
            } else {
                currentPlaylist.set(tracks);
                if ($isShuffle) { 
                    shuffleHistory.set([]); 
                    currentIndex.set(Math.floor(Math.random() * tracks.length)); 
                } else { 
                    currentIndex.set(0); 
                }
            }
        }
    };

    const toggleShuffleMode = () => {
        if (tracks.length === 0) return;
        isShuffle.set(!$isShuffle);
        currentPlaylist.set(tracks);
        if ($isShuffle) { 
            shuffleHistory.set([]); 
            currentIndex.set(Math.floor(Math.random() * tracks.length)); 
        } else { 
            currentIndex.set(0); 
        }
    };

    const playSpecificTrack = (index) => { 
        shuffleHistory.set([]); 
        currentPlaylist.set(tracks); 
        currentIndex.set(index); 
    };

    function swipeToQueue(node, track) {
        let startX = 0, currentX = 0, isSwiping = false, hasVibrated = false;
        const bg = node.previousElementSibling; 
        const onStart = e => { startX = e.touches[0].clientX; isSwiping = false; hasVibrated = false; node.style.transition = 'none'; bg.style.transition = 'none'; };
        const onMove = e => {
            currentX = e.touches[0].clientX - startX;
            if (Math.abs(currentX) > 10) isSwiping = true;
            if (currentX > 0 && currentX < 100) {
                node.style.transform = `translateX(${currentX}px)`; bg.style.width = `${currentX}px`;
                const icon = bg.querySelector('svg');
                if (currentX > 60) {
                    bg.style.backgroundColor = 'var(--accent-color)';
                    if (icon) icon.style.transform = 'translate(-50%, -50%) scale(1.2)';
                    if (!hasVibrated) { if (navigator.vibrate) navigator.vibrate(50); hasVibrated = true; }
                } else {
                    bg.style.backgroundColor = 'rgba(181, 52, 209, 0.5)';
                    if (icon) icon.style.transform = 'translate(-50%, -50%) scale(1)';
                    hasVibrated = false;
                }
            }
        };
        const onEnd = () => {
            node.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'; node.style.transform = 'translateX(0)';
            bg.style.transition = 'width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.3s'; bg.style.width = '0px';
            const icon = bg.querySelector('svg'); if (icon) icon.style.transform = 'translate(-50%, -50%) scale(1)';
            if (currentX > 60) {
                currentPlaylist.update(currentList => {
                    if (!currentList || currentList.length === 0) { currentIndex.set(0); return [track]; }
                    const newList = [...currentList]; let cIdx = 0; currentIndex.subscribe(v => cIdx = v)();
                    newList.splice(cIdx + 1, 0, track); return newList;
                });
            }
            setTimeout(() => { isSwiping = false; currentX = 0; }, 50);
        };
        node.addEventListener('touchstart', onStart, {passive: true}); node.addEventListener('touchmove', onMove, {passive: true}); node.addEventListener('touchend', onEnd);
        return { destroy() { node.removeEventListener('touchstart', onStart); node.removeEventListener('touchmove', onMove); node.removeEventListener('touchend', onEnd); } };
    }
</script>

{#if !isLoading && playlist}
<div class="view-wrapper" class:max-glass={$isMaxGlassActive}>
    <div class="album-header-block">
        <div class="album-hero">
            <div class="cover-wrapper">
                <div class="playlist-cover-wrapper playlist-hero-cover">
                    {#if playlistCovers.length >= 4}
                        <div class="dynamic-grid-cover">
                            {#each playlistCovers as cover}
                                <img src="/api/Tracks/image?path={encodeURIComponent(cover)}" alt="Cover fragment" />
                            {/each}
                        </div>
                    {:else if playlistCovers.length > 0}
                        <img src="/api/Tracks/image?path={encodeURIComponent(playlistCovers[0])}" class="single-cover" alt="Playlist Cover" />
                    {:else}
                        <div class="empty-cover">
                            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                        </div>
                    {/if}
                </div>
            </div>
            <div class="album-info">
                <div class="album-type">Playlist</div>
                <div class="album-title">{playlist.name}</div>
                <div class="album-meta">
                    <span>{tracks.length} songs</span><span class="dot">•</span>
                    <span class="duration-highlight">{timeString}</span>
                </div>
            </div>
        </div>

        <div class="header-separator"></div>

        <div class="action-bar">
            <button class="btn-main-play hoverable" aria-label="Play Playlist" disabled={tracks.length === 0} on:click={togglePlayPlaylist}>
                {#if isPlayingPlaylist}
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><rect width="4" height="16" x="6" y="4"></rect><rect width="4" height="16" x="14" y="4"></rect></svg>
                {:else}
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                {/if}
            </button>
            <button class="btn-icon-bar hoverable" aria-label="Shuffle" disabled={tracks.length === 0} class:active={$isShuffle} on:click={toggleShuffleMode} title="Shuffle">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg>
            </button>
        </div>
    </div>

    {#if tracks.length > 0}
        <div class="list-container active-view" in:fade={{duration: 200}}>
            <div class="list-header">
                <div style="text-align:center;">#</div>
                <div>Title</div>
                <div style="text-align:right;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </div>
            </div>
            
            {#each tracks as track, index}
                <div class="list-item" class:active={($currentPlaylist?.length ?? 0) > 0 && $currentPlaylist[$currentIndex]?.id === track.id}>
                    <div class="swipe-bg"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>
                    <div class="list-item-content" role="button" tabindex="0" use:swipeToQueue={track} on:click={() => playSpecificTrack(index)} on:keydown={(e) => e.key === 'Enter' && playSpecificTrack(index)}>
                        <div class="list-item-num">{index + 1}</div>
                        <div class="track-details-wrapper">
                            <img 
                                class="track-cover"
                                src={`/api/Tracks/image?path=${encodeURIComponent(track.album?.coverPath)}&quality=${$isLowQualityImages ? 'low' : 'high'}`} 
                                alt="Cover" 
                                loading="lazy" 
                            />
                            <div class="track-text-info">
                                <div class="list-item-title">{track.title}</div>
                                <div class="list-item-artist">{track.album?.artist?.name || 'Unknown Artist'}</div>
                            </div>
                        </div>
                        <div class="list-item-time">{formatTime(track.durationSeconds || 0)}</div>
                    </div>
                </div>
            {/each}
        </div>
    {:else}
        <div class="empty-state">
            This playlist is empty. Add some tracks!
        </div>
    {/if}
</div>
{/if}

<style>
    /* View Layout */
    .view-wrapper { 
        position: relative; 
        min-height: 100%; 
        padding: 24px;
    }
    
    /* Header Block */
    .album-header-block { 
        display: flex; 
        flex-direction: column; 
        gap: 0; 
        margin-bottom: 32px; 
        background: var(--surface-color);
        border: 1px solid rgba(255, 255, 255, 0.05); 
        border-radius: 16px; 
        padding: 32px; 
        box-shadow: 0 16px 40px rgba(0,0,0,0.3); 
    }
    .album-hero { 
        display: flex; 
        gap: 32px; 
        align-items: flex-end; 
        margin-bottom: 0; 
    }
    
    .playlist-cover-wrapper.playlist-hero-cover {
        width: 232px; height: 232px; 
        border-radius: 8px; 
        background: rgba(0,0,0,0.4); 
        display: flex; align-items: center; justify-content: center; 
        color: var(--text-secondary); 
        border: 1px solid rgba(255,255,255,0.05); 
        box-shadow: 0 16px 32px rgba(0,0,0,0.4); 
        overflow: hidden;
    }
    
    .dynamic-grid-cover {
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr;
        width: 100%; height: 100%;
    }
    .dynamic-grid-cover img { width: 100%; height: 100%; object-fit: cover; }
    .single-cover { width: 100%; height: 100%; object-fit: cover; }
    .empty-cover { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); }

    .album-type { font-size: 12px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: var(--accent-color); margin-bottom: 8px; }
    .album-title { font-size: clamp(32px, 5vw, 64px); font-weight: 900; line-height: 1.1; margin-bottom: 12px; letter-spacing: -2px; color: var(--text-primary); text-shadow: 0 4px 24px rgba(0,0,0,0.4); }
    .album-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 14px; font-weight: 600; color: var(--text-secondary); }
    .dot { font-size: 10px; opacity: 0.5; }
    .duration-highlight { color: var(--text-primary); font-weight: 800;}
    
    .header-separator { height: 1px; background: rgba(255,255,255,0.1); margin: 24px 0; width: 100%; }
    .action-bar { display: flex; align-items: center; gap: 24px; margin-bottom: 0; }
    
    /* List Container */
    .list-container { 
        display: flex; 
        flex-direction: column; 
    }
    .list-header { 
        display: grid; 
        grid-template-columns: 40px 1fr 60px; 
        gap: 16px;
        padding: 0 16px 12px 16px; 
        border-bottom: 1px solid rgba(255,255,255,0.1); 
        color: var(--text-secondary); 
        font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; 
        margin-bottom: 12px; 
    }

    /* List Items */
    .list-item { 
        position: relative; 
        overflow: hidden; 
        border-radius: 8px; 
        margin-bottom: 4px;
        transition: background-color 0.2s ease; 
    }
    .list-item:hover { background-color: var(--surface-hover); }
    .list-item.active { background-color: rgba(255,255,255,0.1); }
    .list-item.active .list-item-num, .list-item.active .list-item-title { color: var(--accent-color); }
    
    .swipe-bg { position: absolute; top: 0; left: 0; height: 100%; width: 0; background: var(--accent-dark); z-index: 1; display: flex; align-items: center; border-radius: 8px 0 0 8px; overflow: hidden; }
    .swipe-bg svg { position: absolute; left: 30px; top: 50%; transform: translate(-50%, -50%); transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1); }
    
    .list-item-content { position: relative; z-index: 2; display: grid; grid-template-columns: 40px 1fr 60px; gap: 16px; align-items: center; padding: 10px 16px; cursor: pointer; outline: none; }
    .list-item-num { text-align: center; color: var(--text-secondary); font-weight: 500; font-size: 16px; font-variant-numeric: tabular-nums; }
    
    /* Missing Image CSS Added Here */
    .track-details-wrapper { min-width: 0; display: flex; align-items: center; gap: 16px; flex-grow: 1; }
    .track-cover { 
        width: 48px; 
        height: 48px; 
        border-radius: 4px; 
        object-fit: cover; 
        background: rgba(255,255,255,0.05); 
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        flex-shrink: 0;
    }
    .track-text-info { min-width: 0; flex: 1; }
    
    .list-item-title { color: var(--text-primary); font-weight: 600; font-size: 15px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .list-item-artist { color: var(--text-secondary); font-size: 13px; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .list-item-time { text-align: right; color: var(--text-secondary); font-size: 14px; font-variant-numeric: tabular-nums; }

    /* Buttons */
    .hoverable { transition: transform 0.2s, background 0.2s, color 0.2s; cursor: pointer; }
    .btn-main-play { width: 56px; height: 56px; border-radius: 50%; background: var(--accent-color); color: #000; border: none; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 16px rgba(0,0,0,0.3); transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1); }
    .btn-main-play.hoverable:hover { transform: scale(1.05); }
    .btn-main-play.hoverable:active { transform: scale(0.95); }
    .btn-main-play:disabled { opacity: 0.5; filter: grayscale(1); cursor: not-allowed; transform: none !important; }
    
    .btn-icon-bar { background: none; border: none; color: var(--text-secondary); padding: 8px; transition: color 0.2s ease; }
    .btn-icon-bar.active { color: var(--accent-color); }
    .btn-icon-bar.hoverable:hover:not(:disabled) { color: var(--text-primary); transform: scale(1.1); }
    .btn-icon-bar:disabled { opacity: 0.3; cursor: not-allowed; }

    .empty-state { text-align: center; padding: 64px 24px; color: var(--text-secondary); font-size: 16px; font-weight: 600; background: var(--surface-color); border-radius: 16px; border: 1px dashed rgba(255,255,255,0.1); }

    /* Mobile Adjustments */
    @media (max-width: 768px) {
        .view-wrapper { padding: 16px; }
        .album-header-block { padding: 24px; }
        .album-hero { flex-direction: column; align-items: center; gap: 24px; text-align: center; }
        .action-bar { justify-content: center; }
        .playlist-cover-wrapper.playlist-hero-cover { width: 200px; height: 200px; }
        
        .list-header { grid-template-columns: 30px 1fr 40px; padding: 8px 12px; font-size: 10px; gap: 12px; }
        .list-item-content { grid-template-columns: 30px 1fr 40px; padding: 10px 12px; gap: 12px; }
        .track-cover { width: 40px; height: 40px; }
        .list-item-num { font-size: 14px; }
    }
</style>