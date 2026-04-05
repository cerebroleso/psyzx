<script>
    import { get } from 'svelte/store';
    import { fade, scale } from 'svelte/transition';
    import { albumsMap, currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat, shuffleHistory, accentColor, isGlobalColorActive, isMaxGlassActive } from '../../store.js';
    import { formatTime } from '../utils.js';
    import { api } from '../api.js';
    
    function portal(node) {
        document.body.appendChild(node);
        return { destroy() { if (node.parentNode) node.parentNode.removeChild(node); } };
    }

    export let albumId; 

    $: album = $albumsMap.get(parseInt(albumId));
    $: tracks = album ? [...album.tracks].sort((a, b) => {
        const discA = a.discNumber || 1; const discB = b.discNumber || 1;
        if (discA !== discB) return discA - discB;
        if (a.trackNumber !== b.trackNumber && a.trackNumber > 0) return a.trackNumber - b.trackNumber;
        return a.title.localeCompare(b.title);
    }) : [];

    $: discs = [...new Set(tracks.map(t => t.discNumber || 1))].sort((a,b) => a - b);

    $: totalSeconds = tracks.reduce((sum, t) => sum + t.durationSeconds, 0);
    $: hrs = Math.floor(totalSeconds / 3600);
    $: mins = Math.floor((totalSeconds % 3600) / 60);
    $: timeString = hrs > 0 ? `${hrs} hr ${mins} min` : `${mins} min`;
    
    $: totalAlbumPlays = tracks.reduce((sum, t) => sum + (t.playCount || 0), 0);
    $: maxPlay = Math.max(...tracks.map(t => t.playCount || 0));
    
    $: coverUrl = album && album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : '';
    $: avgBitrate = tracks.length > 0 ? Math.round(tracks.reduce((s, t) => s + (t.bitrate||0), 0) / tracks.length) : 0;
    
    $: isPlayingAlbum = $isPlaying && $currentPlaylist.some(t => tracks.find(pt => pt.id === t.id));

    let albumColor = '#b534d1';
    
    const extractAlbumColor = async (url) => {
        if (typeof document === 'undefined') return;
        if (!url) { albumColor = '#b534d1'; return; }
        try {
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) throw new Error('Auth err');
            
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                try {
                    const cvs = document.createElement('canvas'); 
                    cvs.width = 64; cvs.height = 64;
                    const ctx = cvs.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, 64, 64);
                    const [r, g, b] = ctx.getImageData(32, 32, 1, 1).data;
                    const boost = Math.max(r, g, b) < 40 ? 50 : 0;
                    albumColor = `rgb(${r+boost},${g+boost},${b+boost})`;
                } catch(e) { albumColor = '#b534d1'; }
                URL.revokeObjectURL(objUrl);
            };
            img.onerror = () => { albumColor = '#b534d1'; };
            img.src = objUrl;
        } catch (e) {
            albumColor = '#b534d1';
        }
    };
    
    $: extractAlbumColor(coverUrl);

    let viewMode = 'list'; 
    let mounted = false;
    import { onMount } from 'svelte';
    onMount(() => { setTimeout(() => mounted = true, 50); });

    const togglePlayAlbum = () => {
        if (isPlayingAlbum) {
            document.querySelector('audio').pause();
        } else {
            if ($currentPlaylist.some(t => tracks.find(pt => pt.id === t.id))) {
                document.querySelector('audio').play(); 
            } else {
                currentPlaylist.set(tracks);
                if ($isShuffle) { shuffleHistory.set([]); currentIndex.set(Math.floor(Math.random() * tracks.length)); } 
                else { currentIndex.set(0); }
            }
        }
    };

    const toggleShuffleMode = () => {
        isShuffle.set(!$isShuffle);
        currentPlaylist.set(tracks);
        if ($isShuffle) { shuffleHistory.set([]); currentIndex.set(Math.floor(Math.random() * tracks.length)); } 
        else { currentIndex.set(0); }
    };

    const playSpecificTrack = (index) => { shuffleHistory.set([]); currentPlaylist.set(tracks); currentIndex.set(index); };

    let toastMessage = '';
    let toastTimeout;

    const showToast = (msg) => {
        toastMessage = msg;
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => toastMessage = '', 2500);
    };

    // Context Menu State
    let contextMenu = { show: false, x: 0, y: 0, track: null };

    const openContextMenu = (e, track) => {
        e.preventDefault(); // Block default browser menu
        let x = e.clientX;
        let y = e.clientY;
        
        // Prevent menu from clipping off-screen
        if (x + 220 > window.innerWidth) x -= 220;
        if (y + 180 > window.innerHeight) y -= 180;
        
        contextMenu = { show: true, x, y, track };
    };

    const closeContextMenu = () => { contextMenu.show = false; };
    
    // Global click listener to close menu
    const handleGlobalClick = () => { if (contextMenu.show) closeContextMenu(); };

    const addToQueueContext = (track) => {
        currentPlaylist.update(currentList => {
            if (!currentList || currentList.length === 0) { currentIndex.set(0); return [track]; }
            const newList = [...currentList]; 
            let cIdx = 0; currentIndex.subscribe(v => cIdx = v)();
            newList.splice(cIdx + 1, 0, track); 
            return newList;
        });
        showToast('Added to Queue');
        closeContextMenu();
    };

    function swipeToQueue(node, track) {
        let startX = 0, currentX = 0, isSwiping = false, hasVibrated = false;
        const bg = node.parentElement.querySelector('.swipe-bg'); 
        
        const onStart = e => { startX = e.touches[0].clientX; isSwiping = false; hasVibrated = false; node.style.transition = 'none'; bg.style.transition = 'none'; };
        const onMove = e => {
            currentX = e.touches[0].clientX - startX;
            if (Math.abs(currentX) > 10) isSwiping = true;
            if (currentX > 0 && currentX < 100) {
                node.style.transform = `translate3d(${currentX}px, 0, 0)`; 
                bg.style.width = `${currentX}px`;
                const icon = bg.querySelector('svg');
                if (currentX > 60) {
                    bg.style.backgroundColor = '#10b981'; 
                    // FIX: Only use scale(), remove translate
                    if (icon) { icon.style.transform = 'scale(1.2)'; icon.style.stroke = '#ffffff'; }
                    if (!hasVibrated) { if (navigator.vibrate) navigator.vibrate(50); hasVibrated = true; }
                } else {
                    bg.style.backgroundColor = 'rgba(16, 185, 129, 0.4)';
                    // FIX: Only use scale(), remove translate
                    if (icon) { icon.style.transform = 'scale(1)'; icon.style.stroke = '#000000'; }
                    hasVibrated = false;
                }
            }
        };
        const onEnd = () => {
            node.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'; node.style.transform = 'translate3d(0, 0, 0)';
            bg.style.transition = 'width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.3s'; bg.style.width = '0px';
            const icon = bg.querySelector('svg'); 
            // FIX: Only use scale(), remove translate
            if (icon) icon.style.transform = 'scale(1)';
            
            if (currentX > 60) {
                currentPlaylist.update(currentList => {
                    if (!currentList || currentList.length === 0) { currentIndex.set(0); return [track]; }
                    const newList = [...currentList]; let cIdx = 0; currentIndex.subscribe(v => cIdx = v)();
                    newList.splice(cIdx + 1, 0, track); return newList;
                });
                showToast(`Added to queue`); 
            }
            setTimeout(() => { isSwiping = false; currentX = 0; }, 50);
        };
        node.addEventListener('touchstart', onStart, {passive: true}); node.addEventListener('touchmove', onMove, {passive: true}); node.addEventListener('touchend', onEnd);
        return { destroy() { node.removeEventListener('touchstart', onStart); node.removeEventListener('touchmove', onMove); node.removeEventListener('touchend', onEnd); } };
    }

    let showPlaylistModal = false;
    let trackToAdd = null;
    let userPlaylists = [];
    
    let modalTop = 0;
    let modalHeight = 0;

    const openPlaylistSelector = async (track) => {
        trackToAdd = track;
        const mainView = document.getElementById('main-view');
        
        if (mainView) {
            modalTop = mainView.scrollTop;
            modalHeight = mainView.clientHeight;
            mainView.style.overflow = 'hidden';
        }
        
        showPlaylistModal = true;
        try {
            userPlaylists = await api.getPlaylists();
        } catch (e) {}
    };

    const closePlaylistSelector = () => {
        showPlaylistModal = false;
        trackToAdd = null;
        
        const mainView = document.getElementById('main-view');
        if (mainView) {
            mainView.style.overflow = '';
        }
    };

    const addToPlaylist = async (playlistId) => {
        if (!trackToAdd) return;
        const success = await api.addToPlaylist(playlistId, trackToAdd.id);
        if (success) {
            closePlaylistSelector();
        }
    };
</script>

<svelte:window on:click={handleGlobalClick} />

{#if album}
<div class="view-wrapper" class:max-glass={$isMaxGlassActive}>
    {#if !$isGlobalColorActive}
        <div class="fade-bg-dynamic" style="background-color: {albumColor};"></div>
    {/if}
    
    <div class="album-header-block">
        <div class="album-hero">
            <div class="cover-wrapper">
                <img src={coverUrl || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='} alt="Album Cover" style="width: 232px; height: 232px; object-fit: cover;">
            </div>
            <div class="album-info">
                <div class="album-type">Album</div>
                <div class="album-title">{album.title}</div>
                <div class="album-meta">
                    <strong class="album-info-text">{album.artistName}</strong><span class="dot">•</span>
                    <span class="album-info-text">{album.releaseYear > 0 ? album.releaseYear : ''}</span><span class="dot">•</span>
                    <span class="album-info-text">{tracks.length} songs</span><span class="dot">•</span>
                    <span class="duration-highlight">{timeString}</span>
                    
                    {#if avgBitrate > 0}
                    <div class="kbps-badge-inline">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent-color)"><rect x="3" y="8" width="4" height="8"/><rect x="10" y="4" width="4" height="16"/><rect x="17" y="10" width="4" height="4"/></svg>
                        <span>{avgBitrate} kbps</span>
                    </div>
                    {/if}
                </div>
            </div>
        </div>

        <div class="header-separator"></div>

        <div class="action-bar">
            <button class="btn-main-play hoverable" aria-label="Play Album" on:click={togglePlayAlbum}>
                {#if isPlayingAlbum}
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><rect width="4" height="16" x="6" y="4"></rect><rect width="4" height="16" x="14" y="4"></rect></svg>
                {:else}
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                {/if}
            </button>
            <button class="btn-icon-bar hoverable" aria-label="Shuffle" class:active={$isShuffle} on:click={toggleShuffleMode} title="Shuffle">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg>
            </button>
            <button class="btn-icon-bar hoverable" aria-label="Stats View" class:active={viewMode === 'stats'} on:click={() => viewMode = viewMode === 'stats' ? 'list' : 'stats'} title="Toggle Stats Bar">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            </button>
            <button class="btn-icon-bar hoverable" aria-label="PS2 View" class:active={viewMode === 'ps2'} on:click={() => viewMode = viewMode === 'ps2' ? 'list' : 'ps2'} title="PS2 Tower View">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
            </button>
        </div>
    </div>

    {#if viewMode === 'ps2'}
        <div id="ps2-tower-container" class="active-view" in:fade={{duration: 200}}>
            <div class="ps2-scroll-wrapper">
                <div class="ps2-grid">
                    {#each tracks as track, index}
                        {@const ps2Height = maxPlay > 0 ? ((track.playCount || 0) / maxPlay) * 180 + 20 : 20}
                        <div class="ps2-tower-container-3d" style="--tower-h: {ps2Height}px;" role="button" tabindex="0" on:click={() => playSpecificTrack(index)} on:keydown={(e) => e.key === 'Enter' && playSpecificTrack(index)}>
                            <div class="ps2-face ps2-front"></div>
                            <div class="ps2-face ps2-back"></div>
                            <div class="ps2-face ps2-right"></div>
                            <div class="ps2-face ps2-left"></div>
                            <div class="ps2-face ps2-top">{track.trackNumber > 0 ? track.trackNumber : index + 1}</div>
                            <div class="ps2-tooltip">{track.title}<br>{track.playCount || 0} plays</div>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {:else}
        <div class="list-container active-view" class:show-stats={viewMode === 'stats'} id="tracks-container" in:fade={{duration: 200}}>
            <div class="list-header">
                <div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>
            </div>
            
            {#each discs as disc}
                {#if discs.length > 1}
                    <div class="disc-header">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="2"></circle></svg>
                        DISC {disc}
                    </div>
                {/if}
                
                {#each tracks.filter(t => (t.discNumber || 1) === disc) as track}
                    {@const globalIndex = tracks.findIndex(t => t.id === track.id)}
                    {@const pct = totalAlbumPlays > 0 ? ((track.playCount || 0) / totalAlbumPlays) * 100 : 0}
                    
                    <div class="list-item" class:active={$currentPlaylist.length > 0 && $currentPlaylist[$currentIndex]?.id === track.id}>
                        <div class="swipe-bg"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>
                        <div class="stat-bar" style="--stat-w: {mounted && viewMode === 'stats' ? pct : 0}%; transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) {globalIndex * 0.04}s;"></div>
                        <div class="list-item-content" role="button" tabindex="0" use:swipeToQueue={track} on:click={() => playSpecificTrack(globalIndex)} on:keydown={(e) => e.key === 'Enter' && playSpecificTrack(globalIndex)} on:contextmenu={(e) => openContextMenu(e, track)}>
                            <div class="list-item-num">{track.trackNumber > 0 ? track.trackNumber : globalIndex + 1}</div>
                            <div style="min-width: 0;">
                                <div class="list-item-title">{track.title}</div>
                                <div class="list-item-artist">{album.artistName}</div>
                            </div>
                            
                            <div class="list-item-time" style="display: flex; align-items: center; gap: 12px;">
                                <button class="btn-add-playlist" aria-label="Add to Playlist" on:click|stopPropagation={() => openPlaylistSelector(track)}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                                </button>
                                {formatTime(track.durationSeconds)}
                            </div>
                        </div>
                    </div>
                {/each}
            {/each}
        </div>
    {/if}
</div>
{/if}

{#if showPlaylistModal}
    <div class="modal-backdrop" style="top: {modalTop}px; height: {modalHeight}px;" in:fade={{duration: 200}} out:fade={{duration: 150}} on:click={closePlaylistSelector}>
        <div class="modal-glass-card" in:scale={{start: 0.95, duration: 250, opacity: 0}} on:click|stopPropagation>
            <div class="modal-header">
                <h3>Add to Playlist</h3>
                <button class="btn-close" on:click={closePlaylistSelector}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            
            <div class="track-preview">
                <div class="preview-title">{trackToAdd?.title}</div>
                <div class="preview-artist">{album?.artistName}</div>
            </div>

            <div class="modal-list">
                {#each userPlaylists as playlist}
                    <button class="modal-list-item" on:click={() => addToPlaylist(playlist.id)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                        {playlist.name}
                    </button>
                {/each}
                {#if userPlaylists.length === 0}
                    <div style="text-align: center; color: rgba(255,255,255,0.4); padding: 16px;">
                        No playlists found. Create one first!
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<div use:portal class="app-overlays" style="position: absolute; z-index: 9999999;">
    
    {#if toastMessage}
        <div class="toast-notification" in:scale={{start: 0.8, duration: 250}} out:fade={{duration: 200}}>
            <svg class="toast-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>Added to Queue</span>
        </div>
    {/if}

    {#if contextMenu.show}
        <div class="context-menu-glass" style="top: {contextMenu.y}px; left: {contextMenu.x}px;" in:scale={{start: 0.95, duration: 150}} out:fade={{duration: 100}} on:click|stopPropagation>
            <div class="context-header">
                <span class="context-title">{contextMenu.track.title}</span>
            </div>
            <button class="context-btn" on:click={() => { playSpecificTrack(tracks.findIndex(t => t.id === contextMenu.track.id)); closeContextMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                Play Now
            </button>
            <button class="context-btn" on:click={() => addToQueueContext(contextMenu.track)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Add to Queue
            </button>
            <button class="context-btn" on:click={() => { openPlaylistSelector(contextMenu.track); closeContextMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                Add to Playlist
            </button>
        </div>
    {/if}

</div>

<style>
    .view-wrapper { position: relative; min-height: 100%; }
    .fade-bg-dynamic { position: absolute; top: 0; left: 0; width: 100%; height: 400px; -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%); mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%); opacity: 0.35; z-index: 0; pointer-events: none; transition: background-color 0.8s ease-in-out; }
    .album-header-block { display: flex; flex-direction: column; gap: 0; margin-bottom: 24px; background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(32px) saturate(150%); -webkit-backdrop-filter: blur(32px) saturate(150%); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 24px; padding: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.2), inset 1px 1px 0 rgba(255,255,255,0.05); will-change: transform, backdrop-filter;}
    .album-hero { display: flex; gap: 24px; align-items: flex-end; margin-bottom: 0; }
    .action-bar { display: flex; align-items: center; gap: 16px; margin-bottom: 0; }
    .header-separator { height: 1px; background: rgba(255,255,255,0.1); margin: 16px 0; width: 100%; }
    .max-glass .album-header-block { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 8px 32px rgba(0,0,0,0.2), inset 1px 1px 0 rgba(255,255,255,0.1); }
    .max-glass .list-container { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(32px) saturate(150%); -webkit-backdrop-filter: blur(32px) saturate(150%); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 24px; padding: 16px; box-shadow: inset 1px 1px 0 rgba(255,255,255,0.05); will-change: transform, backdrop-filter; }
    .max-glass .list-item { border-radius: 12px; background: transparent; border-bottom: 1px solid rgba(255,255,255,0.02); }
    .max-glass .list-item:hover { background: rgba(255, 255, 255, 0.08); }
    .duration-highlight { color: rgba(255,255,255,0.95); font-weight: 800;}
    .kbps-badge-inline { display: inline-flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.4); padding: 4px 8px; border-radius: 6px; font-size: 11px; font-family: monospace; font-weight: bold; border: 1px solid rgba(255,255,255,0.1); margin-left: 12px; vertical-align: middle; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    .hoverable { transition: transform 0.2s, background 0.2s, color 0.2s; cursor: pointer; }
    .btn-main-play.hoverable:hover { transform: scale(1.05); background: var(--accent-color); color: black; }
    .btn-icon-bar.hoverable:hover { color: white; transform: scale(1.1); }
    .disc-header { font-size: 12px; font-weight: 800; color: var(--accent-color); letter-spacing: 1px; padding: 24px 8px 8px 8px; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; text-transform: uppercase; }
    .ps2-scroll-wrapper { width: 100%; overflow-x: auto; overflow-y: hidden; padding-bottom: 40px; }
    .ps2-grid { display: flex; gap: 24px; align-items: flex-end; height: 350px; padding: 40px 24px 0 24px; perspective: 1200px; transform-style: preserve-3d; width: max-content; }
    .ps2-tower-container-3d { position: relative; width: 36px; height: var(--tower-h); transform-style: preserve-3d; transform: rotateX(-15deg) rotateY(-30deg); transition: transform 0.3s ease; cursor: pointer; flex-shrink: 0; }
    .ps2-tower-container-3d:hover { transform: rotateX(-15deg) rotateY(-30deg) translateY(-10px); }
    .ps2-face { position: absolute; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.2); box-sizing: border-box; }
    .ps2-front { width: 100%; height: 100%; bottom: 0; left: 0; background: var(--accent-color); transform: rotateY(0deg) translateZ(18px); }
    .ps2-back { width: 100%; height: 100%; bottom: 0; left: 0; background: rgba(0,0,0,0.8); transform: rotateY(180deg) translateZ(18px); }
    .ps2-right { width: 100%; height: 100%; bottom: 0; left: 0; background: rgba(0,0,0,0.6); transform: rotateY(90deg) translateZ(18px); }
    .ps2-left { width: 100%; height: 100%; bottom: 0; left: 0; background: rgba(0,0,0,0.6); transform: rotateY(-90deg) translateZ(18px); }
    .ps2-top { width: 36px; height: 36px; top: 0; left: 0; background: rgba(255,255,255,0.4); transform: translateY(-18px) rotateX(90deg); font-size: 11px; font-weight: bold; color: white; text-shadow: 1px 1px 2px black; }
    .ps2-tooltip { position: absolute; bottom: calc(100% + 20px); left: 50%; transform: translateX(-50%) rotateX(15deg) rotateY(30deg); background: #000; color: white; padding: 6px 12px; border-radius: 4px; font-size: 12px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.2s; text-align: center; border: 1px solid var(--accent-color); z-index: 10; }
    .ps2-tower-container-3d:hover .ps2-tooltip { opacity: 1; }
    .btn-add-playlist {
        background: none; border: none; color: rgba(255,255,255,0.3);
        cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        border-radius: 50%;
    }
    .btn-add-playlist:hover {
        color: var(--accent-color);
        background: rgba(255,255,255,0.05);
        transform: scale(1.1);
    }

    @media (max-width: 768px) {
    /* 1. Tighten the main card padding (Bottom is now 8px instead of 20px) */
        .album-header-block {
            padding: 16px 12px 8px 12px !important;
            margin-bottom: 16px !important;
        }

        .album-hero { 
            flex-direction: column; 
            align-items: center; 
            gap: 16px; /* Reduced from 16px */
            text-align: center; 
        } 

        /* 2. Reduce the gap between text info and action buttons */
        .header-separator {
            margin: 0px 0 !important; /* Reduced from 16px */
        }

        /* 3. Ensure the action bar itself doesn't push the bottom away */
        .action-bar { 
            justify-content: left; 
            flex-wrap: wrap; 
            gap: 24px !important; /* Tighter button spacing */
            margin-bottom: 4px !important; 
        } 

        /* Optional: Shrink the cover size slightly to give text more room */
        .album-hero .cover-wrapper img {
            width: 180px !important;
            height: 180px !important;
        }

        .album-info { 
            align-items: center; 
            text-align: center; 
        } 

        /* Existing font size fixes */
        .album-info-text, .duration-highlight, .kbps-badge-inline {
            font-size: 7px;
        }

        .list-item-title {
            padding-right: 12px;
            font-size: 12px;
        }

        .list-item-time {
            font-size: 10px;
        }

        .btn-add-playlist {
            margin-left: -16px;
            margin-right: -2px;
        }

    }

    .modal-backdrop {
        position: absolute; left: 0; width: 100%;
        background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: 999999; display: flex; align-items: center; justify-content: center;
    }

    .modal-glass-card {
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(40px) saturate(150%);
        -webkit-backdrop-filter: blur(40px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-top: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 24px; padding: 24px;
        width: 90%; max-width: 400px;
        box-shadow: 0 32px 64px rgba(0, 0, 0, 0.5);
    }

    .modal-header {
        display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;
    }
    
    .modal-header h3 { margin: 0; color: white; font-weight: 800; font-size: 20px; }
    
    .btn-close {
        background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; padding: 4px; border-radius: 50%; transition: all 0.2s;
    }
    .btn-close:hover { color: white; background: rgba(255,255,255,0.1); }

    .track-preview {
        background: rgba(0,0,0,0.3); padding: 12px 16px; border-radius: 12px; margin-bottom: 24px;
        border: 1px solid rgba(255,255,255,0.05);
    }
    .preview-title { color: white; font-weight: bold; font-size: 15px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .preview-artist { color: rgba(255,255,255,0.5); font-size: 13px; }

    .modal-list {
        display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;
    }

    .modal-list-item {
        background: rgba(255,255,255,0.03); border: 1px solid transparent;
        color: white; font-weight: 600; padding: 16px; border-radius: 12px;
        display: flex; align-items: center; gap: 12px; cursor: pointer; transition: all 0.2s; text-align: left;
    }

    .modal-list-item svg { color: rgba(255,255,255,0.5); transition: color 0.2s; }
    .modal-list-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.1); }
    .modal-list-item:hover svg { color: var(--accent-color); }

    /* Perfectly Centered Flexbox Background */
    .swipe-bg { 
        position: absolute; top: 0; left: 0; bottom: 0; width: 0; 
        background: rgba(181, 52, 209, 0.5); z-index: 1; 
        display: flex; align-items: center; /* This perfectly centers the plus vertically */
        border-radius: 8px; overflow: hidden; 
    }
    
    .swipe-bg svg { 
        margin-left: 20px; /* Pushes it away from the left edge */
        flex-shrink: 0;
        transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1); 
        /* Removed position: absolute and top: 50% */
    }

    /* iOS 8 Ringer Style Toast */
    .toast-notification {
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(20, 20, 20, 0.85); 
        backdrop-filter: blur(25px) saturate(150%); 
        -webkit-backdrop-filter: blur(25px) saturate(150%);
        color: white; font-weight: 600; font-size: 16px;
        width: 170px; height: 170px; border-radius: 28px; z-index: 9999999;
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.05);
        pointer-events: none; /* PREVENTS THE UI FROM FREEZING */
    }
    .toast-icon { width: 56px; height: 56px; stroke-width: 1.5px; stroke: white; }

    /* CONTEXT MENU */
    .context-menu-glass {
        position: fixed; width: 220px; z-index: 9999999;
        background: rgba(25, 25, 25, 0.85); backdrop-filter: blur(32px) saturate(150%); -webkit-backdrop-filter: blur(32px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);
        display: flex; flex-direction: column; padding: 6px;
    }
    .context-header { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 4px; }
    .context-title { font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
    .context-btn {
        background: transparent; border: none; color: white; font-size: 14px; font-weight: 500;
        padding: 10px 12px; border-radius: 8px; display: flex; align-items: center; gap: 12px;
        cursor: pointer; transition: background 0.2s; text-align: left;
    }
    .context-btn:hover { background: rgba(255,255,255,0.1); color: var(--accent-color); }
    .context-btn svg { color: rgba(255,255,255,0.5); transition: color 0.2s; }
    .context-btn:hover svg { color: var(--accent-color); }
</style>

<!-- pop-up mockup <script>
    import { get } from 'svelte/store';
    import { fade, scale } from 'svelte/transition'; // Aggiunto scale per il modal
    import { albumsMap, currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat, shuffleHistory, accentColor, isGlobalColorActive, isMaxGlassActive } from '../../store.js';
    import { formatTime } from '../utils.js';

    export let albumId; 

    $: album = $albumsMap.get(parseInt(albumId));
    $: tracks = album ? [...album.tracks].sort((a, b) => {
        const discA = a.discNumber || 1; const discB = b.discNumber || 1;
        if (discA !== discB) return discA - discB;
        if (a.trackNumber !== b.trackNumber && a.trackNumber > 0) return a.trackNumber - b.trackNumber;
        return a.title.localeCompare(b.title);
    }) : [];

    $: discs = [...new Set(tracks.map(t => t.discNumber || 1))].sort((a,b) => a - b);

    $: totalSeconds = tracks.reduce((sum, t) => sum + t.durationSeconds, 0);
    $: hrs = Math.floor(totalSeconds / 3600);
    $: mins = Math.floor((totalSeconds % 3600) / 60);
    $: timeString = hrs > 0 ? `${hrs} hr ${mins} min` : `${mins} min`;
    
    $: totalAlbumPlays = tracks.reduce((sum, t) => sum + (t.playCount || 0), 0);
    $: maxPlay = Math.max(...tracks.map(t => t.playCount || 0));
    
    $: coverUrl = album && album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : '';
    $: avgBitrate = tracks.length > 0 ? Math.round(tracks.reduce((s, t) => s + (t.bitrate||0), 0) / tracks.length) : 0;
    
    $: isPlayingAlbum = $isPlaying && $currentPlaylist.some(t => tracks.find(pt => pt.id === t.id));

    let albumColor = '#b534d1';
    
    const extractAlbumColor = async (url) => {
        if (typeof document === 'undefined') return;
        if (!url) { albumColor = '#b534d1'; return; }
        try {
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) throw new Error('Auth err');
            
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                try {
                    const cvs = document.createElement('canvas'); 
                    cvs.width = 64; cvs.height = 64;
                    const ctx = cvs.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, 64, 64);
                    const [r, g, b] = ctx.getImageData(32, 32, 1, 1).data;
                    const boost = Math.max(r, g, b) < 40 ? 50 : 0;
                    albumColor = `rgb(${r+boost},${g+boost},${b+boost})`;
                } catch(e) { albumColor = '#b534d1'; }
                URL.revokeObjectURL(objUrl);
            };
            img.onerror = () => { albumColor = '#b534d1'; };
            img.src = objUrl;
        } catch (e) {
            albumColor = '#b534d1';
        }
    };
    
    $: extractAlbumColor(coverUrl);

    let viewMode = 'list'; 
    let mounted = false;
    import { onMount } from 'svelte';
    onMount(() => { setTimeout(() => mounted = true, 50); });

    const togglePlayAlbum = () => {
        if (isPlayingAlbum) {
            document.querySelector('audio').pause();
        } else {
            if ($currentPlaylist.some(t => tracks.find(pt => pt.id === t.id))) {
                document.querySelector('audio').play(); 
            } else {
                currentPlaylist.set(tracks);
                if ($isShuffle) { shuffleHistory.set([]); currentIndex.set(Math.floor(Math.random() * tracks.length)); } 
                else { currentIndex.set(0); }
            }
        }
    };

    const toggleShuffleMode = () => {
        isShuffle.set(!$isShuffle);
        currentPlaylist.set(tracks);
        if ($isShuffle) { shuffleHistory.set([]); currentIndex.set(Math.floor(Math.random() * tracks.length)); } 
        else { currentIndex.set(0); }
    };

    const playSpecificTrack = (index) => { shuffleHistory.set([]); currentPlaylist.set(tracks); currentIndex.set(index); };

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

    // GESTIONE MODAL PLAYLIST
    let showPlaylistModal = false;
    let trackToAdd = null;
    let dummyPlaylists = [
        { id: 1, name: 'Night Drive' },
        { id: 2, name: 'Arch Linux Compilation' }
    ];

    const openPlaylistSelector = (track) => {
        trackToAdd = track;
        showPlaylistModal = true;
    };

    const closePlaylistSelector = () => {
        showPlaylistModal = false;
        trackToAdd = null;
    };

    const addToPlaylist = (playlistId) => {
        // TODO: Chiamata API POST /api/Playlists/{playlistId}/tracks
        console.log(`Added "${trackToAdd.title}" to playlist ID: ${playlistId}`);
        closePlaylistSelector();
    };
</script>

{#if album}
<div class="view-wrapper" class:max-glass={$isMaxGlassActive}>
    {#if !$isGlobalColorActive}
        <div class="fade-bg-dynamic" style="background-color: {albumColor};"></div>
    {/if}
    
    <div class="album-header-block">
        <div class="album-hero">
            <div class="cover-wrapper">
                <img src={coverUrl || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='} alt="Album Cover" style="width: 232px; height: 232px; object-fit: cover;">
            </div>
            <div class="album-info">
                <div class="album-type">Album</div>
                <div class="album-title">{album.title}</div>
                <div class="album-meta">
                    <strong>{album.artistName}</strong><span class="dot">•</span>
                    <span>{album.releaseYear > 0 ? album.releaseYear : ''}</span><span class="dot">•</span>
                    <span>{tracks.length} songs</span><span class="dot">•</span>
                    <span class="duration-highlight">{timeString}</span>
                    
                    {#if avgBitrate > 0}
                    <div class="kbps-badge-inline">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent-color)"><rect x="3" y="8" width="4" height="8"/><rect x="10" y="4" width="4" height="16"/><rect x="17" y="10" width="4" height="4"/></svg>
                        <span>{avgBitrate} kbps</span>
                        <span class="ext">AVG</span>
                    </div>
                    {/if}
                </div>
            </div>
        </div>

        <div class="header-separator"></div>

        <div class="action-bar">
            <button class="btn-main-play hoverable" aria-label="Play Album" on:click={togglePlayAlbum}>
                {#if isPlayingAlbum}
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><rect width="4" height="16" x="6" y="4"></rect><rect width="4" height="16" x="14" y="4"></rect></svg>
                {:else}
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                {/if}
            </button>
            <button class="btn-icon-bar hoverable" aria-label="Shuffle" class:active={$isShuffle} on:click={toggleShuffleMode} title="Shuffle">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg>
            </button>
            <button class="btn-icon-bar hoverable" aria-label="Stats View" class:active={viewMode === 'stats'} on:click={() => viewMode = viewMode === 'stats' ? 'list' : 'stats'} title="Toggle Stats Bar">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            </button>
            <button class="btn-icon-bar hoverable" aria-label="PS2 View" class:active={viewMode === 'ps2'} on:click={() => viewMode = viewMode === 'ps2' ? 'list' : 'ps2'} title="PS2 Tower View">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
            </button>
        </div>
    </div>

    {#if viewMode === 'ps2'}
        <div id="ps2-tower-container" class="active-view" in:fade={{duration: 200}}>
            <div class="ps2-scroll-wrapper">
                <div class="ps2-grid">
                    {#each tracks as track, index}
                        {@const ps2Height = maxPlay > 0 ? ((track.playCount || 0) / maxPlay) * 180 + 20 : 20}
                        <div class="ps2-tower-container-3d" style="--tower-h: {ps2Height}px;" role="button" tabindex="0" on:click={() => playSpecificTrack(index)} on:keydown={(e) => e.key === 'Enter' && playSpecificTrack(index)}>
                            <div class="ps2-face ps2-front"></div>
                            <div class="ps2-face ps2-back"></div>
                            <div class="ps2-face ps2-right"></div>
                            <div class="ps2-face ps2-left"></div>
                            <div class="ps2-face ps2-top">{track.trackNumber > 0 ? track.trackNumber : index + 1}</div>
                            <div class="ps2-tooltip">{track.title}<br>{track.playCount || 0} plays</div>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {:else}
        <div class="list-container active-view" class:show-stats={viewMode === 'stats'} id="tracks-container" in:fade={{duration: 200}}>
            <div class="list-header">
                <div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>
            </div>
            
            {#each discs as disc}
                {#if discs.length > 1}
                    <div class="disc-header">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="2"></circle></svg>
                        DISC {disc}
                    </div>
                {/if}
                
                {#each tracks.filter(t => (t.discNumber || 1) === disc) as track}
                    {@const globalIndex = tracks.findIndex(t => t.id === track.id)}
                    {@const pct = totalAlbumPlays > 0 ? ((track.playCount || 0) / totalAlbumPlays) * 100 : 0}
                    
                    <div class="list-item" class:active={$currentPlaylist.length > 0 && $currentPlaylist[$currentIndex]?.id === track.id}>
                        <div class="swipe-bg"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>
                        <div class="stat-bar" style="--stat-w: {mounted && viewMode === 'stats' ? pct : 0}%; transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) {globalIndex * 0.04}s;"></div>
                        <div class="list-item-content" role="button" tabindex="0" use:swipeToQueue={track} on:click={() => playSpecificTrack(globalIndex)} on:keydown={(e) => e.key === 'Enter' && playSpecificTrack(globalIndex)}>
                            <div class="list-item-num">{track.trackNumber > 0 ? track.trackNumber : globalIndex + 1}</div>
                            <div style="min-width: 0;">
                                <div class="list-item-title">{track.title}</div>
                                <div class="list-item-artist">{album.artistName}</div>
                            </div>
                            
                            <div class="list-item-time" style="display: flex; align-items: center; gap: 12px;">
                                <button class="btn-add-playlist" style="padding-left: 0px;" aria-label="Add to Playlist" on:click|stopPropagation={() => openPlaylistSelector(track)}>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                                </button>
                                {formatTime(track.durationSeconds)}
                            </div>
                        </div>
                    </div>
                {/each}
            {/each}
        </div>
    {/if}
</div>
{/if}

{#if showPlaylistModal}
    <div class="modal-backdrop" in:fade={{duration: 200}} out:fade={{duration: 150}} on:click={closePlaylistSelector}>
        <div class="modal-glass-card" in:scale={{start: 0.95, duration: 250, opacity: 0}} on:click|stopPropagation>
            <div class="modal-header">
                <h3>Add to Playlist</h3>
                <button class="btn-close" on:click={closePlaylistSelector}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            
            <div class="track-preview">
                <div class="preview-title">{trackToAdd?.title}</div>
                <div class="preview-artist">{album?.artistName}</div>
            </div>

            <div class="modal-list">
                {#each dummyPlaylists as playlist}
                    <button class="modal-list-item" on:click={() => addToPlaylist(playlist.id)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                        {playlist.name}
                    </button>
                {/each}
            </div>
        </div>
    </div>
{/if}

<style>
    /* ... (MANTIENI TUTTO IL TUO CSS ESISTENTE QUI SOTTO) ... */
    .view-wrapper { position: relative; min-height: 100%; }
    .fade-bg-dynamic { position: absolute; top: 0; left: 0; width: 100%; height: 400px; -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%); mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%); opacity: 0.35; z-index: 0; pointer-events: none; transition: background-color 0.8s ease-in-out; }
    .album-header-block { display: flex; flex-direction: column; gap: 0; margin-bottom: 24px; background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(32px) saturate(150%); -webkit-backdrop-filter: blur(32px) saturate(150%); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 24px; padding: 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.2), inset 1px 1px 0 rgba(255,255,255,0.05); will-change: transform, backdrop-filter; }
    .album-hero { display: flex; gap: 24px; align-items: flex-end; margin-bottom: 0; }
    .action-bar { display: flex; align-items: center; gap: 16px; margin-bottom: 0; }
    .header-separator { height: 1px; background: rgba(255,255,255,0.1); margin: 16px 0; width: 100%; }
    .max-glass .album-header-block { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 8px 32px rgba(0,0,0,0.2), inset 1px 1px 0 rgba(255,255,255,0.1); }
    .max-glass .list-container { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(32px) saturate(150%); -webkit-backdrop-filter: blur(32px) saturate(150%); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 24px; padding: 16px; box-shadow: inset 1px 1px 0 rgba(255,255,255,0.05); will-change: transform, backdrop-filter; }
    .max-glass .list-item { border-radius: 12px; background: transparent; border-bottom: 1px solid rgba(255,255,255,0.02); }
    .max-glass .list-item:hover { background: rgba(255, 255, 255, 0.08); }
    .duration-highlight { color: var(--accent-color); font-weight: 800; text-shadow: 0 0 8px rgba(181, 52, 209, 0.4); }
    .kbps-badge-inline { display: inline-flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.4); padding: 4px 8px; border-radius: 6px; font-size: 11px; font-family: monospace; font-weight: bold; border: 1px solid rgba(255,255,255,0.1); margin-left: 12px; vertical-align: middle; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    .kbps-badge-inline .ext { color: var(--accent-color); }
    .hoverable { transition: transform 0.2s, background 0.2s, color 0.2s; cursor: pointer; }
    .btn-main-play.hoverable:hover { transform: scale(1.05); background: var(--accent-color); color: black; }
    .btn-icon-bar.hoverable:hover { color: white; transform: scale(1.1); }
    .disc-header { font-size: 12px; font-weight: 800; color: var(--accent-color); letter-spacing: 1px; padding: 24px 8px 8px 8px; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; text-transform: uppercase; }
    .ps2-scroll-wrapper { width: 100%; overflow-x: auto; overflow-y: hidden; padding-bottom: 40px; }
    .ps2-grid { display: flex; gap: 24px; align-items: flex-end; height: 350px; padding: 40px 24px 0 24px; perspective: 1200px; transform-style: preserve-3d; width: max-content; }
    .ps2-tower-container-3d { position: relative; width: 36px; height: var(--tower-h); transform-style: preserve-3d; transform: rotateX(-15deg) rotateY(-30deg); transition: transform 0.3s ease; cursor: pointer; flex-shrink: 0; }
    .ps2-tower-container-3d:hover { transform: rotateX(-15deg) rotateY(-30deg) translateY(-10px); }
    .ps2-face { position: absolute; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.2); box-sizing: border-box; }
    .ps2-front { width: 100%; height: 100%; bottom: 0; left: 0; background: var(--accent-color); transform: rotateY(0deg) translateZ(18px); }
    .ps2-back { width: 100%; height: 100%; bottom: 0; left: 0; background: rgba(0,0,0,0.8); transform: rotateY(180deg) translateZ(18px); }
    .ps2-right { width: 100%; height: 100%; bottom: 0; left: 0; background: rgba(0,0,0,0.6); transform: rotateY(90deg) translateZ(18px); }
    .ps2-left { width: 100%; height: 100%; bottom: 0; left: 0; background: rgba(0,0,0,0.6); transform: rotateY(-90deg) translateZ(18px); }
    .ps2-top { width: 36px; height: 36px; top: 0; left: 0; background: rgba(255,255,255,0.4); transform: translateY(-18px) rotateX(90deg); font-size: 11px; font-weight: bold; color: white; text-shadow: 1px 1px 2px black; }
    .ps2-tooltip { position: absolute; bottom: calc(100% + 20px); left: 50%; transform: translateX(-50%) rotateX(15deg) rotateY(30deg); background: #000; color: white; padding: 6px 12px; border-radius: 4px; font-size: 12px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.2s; text-align: center; border: 1px solid var(--accent-color); z-index: 10; }
    .ps2-tower-container-3d:hover .ps2-tooltip { opacity: 1; }
    @media (max-width: 768px) { .album-hero { flex-direction: column; align-items: center; gap: 16px; text-align: center; } .album-info { align-items: center; text-align: center; } .action-bar { justify-content: center; flex-wrap: wrap; } }

    /* NUOVO CSS PER PULSANTE + E MODAL PLAYLIST */
    .btn-add-playlist {
        background: none; border: none; color: rgba(255,255,255,0.3);
        cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        border-radius: 50%;
    }
    .btn-add-playlist:hover {
        color: var(--accent-color);
        background: rgba(255,255,255,0.05);
        transform: scale(1.1);
    }

    .modal-backdrop {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
        z-index: 999999; display: flex; align-items: center; justify-content: center;
    }

    .modal-glass-card {
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(40px) saturate(150%);
        -webkit-backdrop-filter: blur(40px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-top: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 24px; padding: 24px;
        width: 90%; max-width: 400px;
        box-shadow: 0 32px 64px rgba(0, 0, 0, 0.5);
    }

    .modal-header {
        display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;
    }
    
    .modal-header h3 { margin: 0; color: white; font-weight: 800; font-size: 20px; }
    
    .btn-close {
        background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; padding: 4px; border-radius: 50%; transition: all 0.2s;
    }
    .btn-close:hover { color: white; background: rgba(255,255,255,0.1); }

    .track-preview {
        background: rgba(0,0,0,0.3); padding: 12px 16px; border-radius: 12px; margin-bottom: 24px;
        border: 1px solid rgba(255,255,255,0.05);
    }
    .preview-title { color: white; font-weight: bold; font-size: 15px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .preview-artist { color: rgba(255,255,255,0.5); font-size: 13px; }

    .modal-list {
        display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;
    }

    .modal-list-item {
        background: rgba(255,255,255,0.03); border: 1px solid transparent;
        color: white; font-weight: 600; padding: 16px; border-radius: 12px;
        display: flex; align-items: center; gap: 12px; cursor: pointer; transition: all 0.2s; text-align: left;
    }

    .modal-list-item svg { color: rgba(255,255,255,0.5); transition: color 0.2s; }
    .modal-list-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.1); }
    .modal-list-item:hover svg { color: var(--accent-color); }
</style> -->