<script>
    import { onMount, onDestroy } from 'svelte';
    import { fade, scale, fly } from 'svelte/transition';
    import { flip } from 'svelte/animate';
    import { api } from '../api.js';
    import { currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat, shuffleHistory, isGlobalColorActive, isMaxGlassActive, isLowQualityImages, userQueue, albumsMap, playlistUpdateSignal, appSessionVersion } from '../../store.js';
    import { formatTime } from '../utils.js';
    import { togglePlayGlobal, unlockAudioContext } from '../audio.js';

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

    $: {
        $playlistUpdateSignal;
        if (playlistId) loadPlaylist();
    }

    // WS4: Listen for direct playlist-tracks-changed events (fired by api.addToPlaylist)
    // This ensures live refresh even if the store signal doesn't trigger reactivity.
    const handlePlaylistChanged = (e) => {
        if (e.detail?.playlistId == playlistId) {
            loadPlaylist();
        }
    };

    onMount(() => {
        loadPlaylist();
        window.addEventListener('playlist-tracks-changed', handlePlaylistChanged);
    });

    onDestroy(() => {
        window.removeEventListener('playlist-tracks-changed', handlePlaylistChanged);
    });

    // Set to track recently added track IDs for the green pulse animation
    let justAdded = new Set();

    async function loadPlaylist() {
        if (playlistId) {
            playlist = await api.getPlaylist(playlistId);
            if (playlist && playlist.tracks) {
                const incoming = [...playlist.tracks].reverse();

                // Smart merge: detect genuinely new tracks to animate them
                if (tracks.length > 0) {
                    const existingIds = new Set(tracks.map(t => t.id));
                    const newTracks = incoming.filter(t => !existingIds.has(t.id));
                    if (newTracks.length > 0) {
                        // Mark new tracks for the green pulse highlight
                        newTracks.forEach(t => justAdded.add(t.id));
                        justAdded = justAdded; // trigger reactivity
                        // Clear highlights after 2s
                        setTimeout(() => { justAdded = new Set(); }, 2000);
                    }
                }

                tracks = incoming;

                // Patch albumsMap so Player/FullPlayer can resolve cover art and artist name
                albumsMap.update(map => {
                    tracks.forEach(t => {
                        if (t.albumId && !map.has(t.albumId) && t.album) {
                            const al = t.album;
                            const ar = al.artist || {};
                            map.set(t.albumId, {
                                id: al.id,
                                title: al.title,
                                coverPath: al.coverPath,
                                releaseYear: al.releaseYear,
                                playCount: al.playCount || 0,
                                artistId: ar.id,
                                artistName: ar.name || 'Unknown Artist',
                                tracks: []
                            });
                        }
                    });
                    return new Map(map);
                });
            }
        }
        isLoading = false;
    }

    const togglePlayPlaylist = () => {
        if (tracks.length === 0) return;
        if (typeof window !== "undefined") unlockAudioContext();

        if (isPlayingPlaylist) {
            togglePlayGlobal();
        } else {
            if ($currentPlaylist?.some(t => tracks.find(pt => pt.id === t.id))) {
                togglePlayGlobal(); 
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
        if (typeof window !== "undefined") unlockAudioContext();
        shuffleHistory.set([]); 
        currentPlaylist.set(tracks); 
        currentIndex.set(index); 
    };

    let toastMessage = '';
    let toastTimeout;

    const showToast = (msg) => {
        toastMessage = msg;
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => toastMessage = '', 2500);
    };

    const removeTrackFromPlaylist = async (track) => {
        const success = await api.removeTrackFromPlaylist(playlistId, track.id);
        if (success) {
            tracks = tracks.filter(t => t.id !== track.id);
            showToast('Track removed');
        } else {
            showToast('Failed to remove track');
        }
    };

    const deleteCurrentPlaylist = async () => {
        if (confirm(`Are you sure you want to delete ${playlist.name}?`)) {
            const success = await api.deletePlaylist(playlistId);
            if (success) {
                window.location.hash = '#playlists';
            } else {
                showToast('Failed to delete playlist');
            }
        }
    };

    function swipeToQueue(node, track) {
        let startX = 0, startY = 0, currentX = 0, isSwiping = false, hasVibrated = false, blockSwipe = false;
        const bgLeft = node.parentElement.querySelector('.swipe-bg-left'); 
        const bgRight = node.parentElement.querySelector('.swipe-bg-right'); 
        
        const onStart = e => { 
            startX = e.touches[0].clientX; 
            startY = e.touches[0].clientY;
            isSwiping = false; 
            hasVibrated = false; 
            blockSwipe = false;
            node.style.transition = 'none'; 
            if (bgLeft) bgLeft.style.transition = 'none'; 
            if (bgRight) bgRight.style.transition = 'none'; 
        };

        const onMove = e => {
            if (blockSwipe) return;

            let deltaX = e.touches[0].clientX - startX;
            let deltaY = e.touches[0].clientY - startY;

            if (!isSwiping && Math.abs(deltaY) > Math.abs(deltaX) * 0.8) {
                blockSwipe = true;
                return;
            }

            currentX = Math.max(-120, Math.min(120, deltaX));

            if (Math.abs(currentX) > 10) isSwiping = true;
            
            node.style.transform = `translate3d(${currentX}px, 0, 0)`; 

            // Swipe Right (Add to Queue)
            if (currentX > 0 && bgLeft && bgRight) {
                bgRight.style.width = '0px';
                bgLeft.style.width = `${currentX}px`;
                const icon = bgLeft.querySelector('svg');
                if (currentX > 60) {
                    bgLeft.style.backgroundColor = '#10b981'; 
                    if (icon) icon.style.transform = 'scale(1.2)';
                    if (!hasVibrated) { if (navigator.vibrate) navigator.vibrate(50); hasVibrated = true; }
                } else {
                    bgLeft.style.backgroundColor = 'rgba(16, 185, 129, 0.4)';
                    if (icon) icon.style.transform = 'scale(1)';
                    hasVibrated = false;
                }
            } 
            // Swipe Left (Remove from Playlist)
            else if (currentX < 0 && bgLeft && bgRight) {
                bgLeft.style.width = '0px';
                const width = Math.abs(currentX);
                bgRight.style.width = `${width}px`;
                const icon = bgRight.querySelector('svg');
                if (width > 60) {
                    bgRight.style.backgroundColor = '#ef4444'; 
                    if (icon) icon.style.transform = 'scale(1.2)';
                    if (!hasVibrated) { if (navigator.vibrate) navigator.vibrate(50); hasVibrated = true; }
                } else {
                    bgRight.style.backgroundColor = 'rgba(239, 68, 68, 0.4)';
                    if (icon) icon.style.transform = 'scale(1)';
                    hasVibrated = false;
                }
            }
        };

        const onEnd = () => {
            node.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'; 
            node.style.transform = 'translate3d(0, 0, 0)';
            
            if (bgLeft) {
                bgLeft.style.transition = 'width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.3s'; 
                bgLeft.style.width = '0px';
            }
            if (bgRight) {
                bgRight.style.transition = 'width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.3s'; 
                bgRight.style.width = '0px';
            }

            if (currentX > 60 && !blockSwipe) {
                userQueue.update(q => [...q, track]);
                showToast(`Added to queue`); 
            } else if (currentX < -60 && !blockSwipe) {
                removeTrackFromPlaylist(track);
            }
            
            setTimeout(() => { isSwiping = false; currentX = 0; blockSwipe = false; }, 50);
        };

        node.addEventListener('touchstart', onStart, {passive: true}); 
        node.addEventListener('touchmove', onMove, {passive: true}); 
        node.addEventListener('touchend', onEnd);
        return { destroy() { node.removeEventListener('touchstart', onStart); node.removeEventListener('touchmove', onMove); node.removeEventListener('touchend', onEnd); } };
    }
    
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
        userQueue.update(q => [...q, track]);
        showToast('Added to Queue');
        closeContextMenu();
    };

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

    const addToPlaylist = async (targetPlaylistId) => {
        if (!trackToAdd) return;
        const success = await api.addToPlaylist(targetPlaylistId, trackToAdd.id);
        if (success) {
            closePlaylistSelector();
            showToast('Added to playlist');
            if (targetPlaylistId === parseInt(playlistId)) {
                loadPlaylist();
            }
        }
    };

    function portal(node) {
        document.body.appendChild(node);
        return { destroy() { if (node.parentNode) node.parentNode.removeChild(node); } };
    }
</script>

<svelte:window on:click={handleGlobalClick} />

{#if !isLoading && playlist}
<div class="view-wrapper" class:max-glass={$isMaxGlassActive}>
    <div class="album-header-block">
        <div class="album-hero">
            <div class="cover-wrapper">
                <div class="playlist-cover-wrapper playlist-hero-cover">
                    {#if playlistCovers.length >= 4}
                        <div class="dynamic-grid-cover">
                            {#each playlistCovers as cover}
                                <img src="/api/Tracks/image?path={encodeURIComponent(cover.split('?')[0])}&v={$appSessionVersion}" alt="Cover fragment" />
                            {/each}
                        </div>
                    {:else if playlistCovers.length > 0}
                        <img src="/api/Tracks/image?path={encodeURIComponent(playlistCovers[0].split('?')[0])}&v={$appSessionVersion}" class="single-cover" alt="Playlist Cover" />
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
            <button class="btn-icon-bar hoverable btn-delete-playlist" aria-label="Delete Playlist" on:click={deleteCurrentPlaylist} title="Delete Playlist">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
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
            
            {#each tracks as track, index (track.id)}
                <div class="list-item" 
                     class:active={($currentPlaylist?.length ?? 0) > 0 && $currentPlaylist[$currentIndex]?.id === track.id}
                     class:just-added={justAdded.has(track.id)}
                     animate:flip={{duration: 600}}
                     in:fly={{y: 30, duration: 500, delay: 100}}
                     out:fade={{duration: 300}}>
                        <div class="swipe-bg-left">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="6" y="5" width="12" height="6" rx="3" />
                                <line x1="6" y1="15" x2="18" y2="15"></line>
                                <line x1="6" y1="19" x2="18" y2="19"></line>
                            </svg>
                        </div>
                        <div class="swipe-bg-right">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </div>
                    <div class="list-item-content" role="button" tabindex="0" use:swipeToQueue={track} on:click={() => playSpecificTrack(index)} on:keydown={(e) => e.key === 'Enter' && playSpecificTrack(index)} on:contextmenu={(e) => openContextMenu(e, track)}>
                        <div class="list-item-num">{index + 1}</div>
                        <div class="track-details-wrapper">
                            <img 
                                class="track-cover"
                                src={`/api/Tracks/image?path=${encodeURIComponent(track.album?.coverPath?.split('?')[0] || '')}&quality=${$isLowQualityImages ? 'low' : 'high'}&v=${$appSessionVersion}`} 
                                alt="Cover" 
                                loading="lazy" 
                            />
                            <div class="track-text-info">
                                <div class="list-item-title">{track.title}</div>
                                <div class="list-item-artist">{track.album?.artist?.name || 'Unknown Artist'}</div>
                            </div>
                        </div>
                        <div class="list-item-time" style="display: flex; align-items: center; gap: 6px; ">
                            <button class="btn-add-playlist user-remove-track" aria-label="Remove from Playlist" on:click|stopPropagation={() => removeTrackFromPlaylist(track)}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                            <div style="font-size: 12px;">{formatTime(track.durationSeconds || 0)}</div>
                        </div>
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

{#if showPlaylistModal}
    <div class="modal-backdrop" role="button" tabindex="-1" style="top: {modalTop}px; height: {modalHeight}px;" in:fade={{duration: 200}} out:fade={{duration: 150}} on:click={closePlaylistSelector} on:keydown={(e) => e.key === 'Escape' && closePlaylistSelector()}>
        <div class="modal-glass-card" role="dialog" aria-modal="true" in:scale={{start: 0.95, duration: 250, opacity: 0}} on:click|stopPropagation>
            <div class="modal-header">
                <h3>Add to Playlist</h3>
                <button class="btn-close" aria-label="Close" on:click={closePlaylistSelector}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            
            <div class="track-preview">
                <div class="preview-title">{trackToAdd?.title}</div>
                <div class="preview-artist">{trackToAdd?.album?.artist?.name || 'Unknown Artist'}</div>
            </div>

            <div class="modal-list">
                {#each userPlaylists as p}
                    <button class="modal-list-item" on:click={() => addToPlaylist(p.id)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                        {p.name}
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
            <svg class="toast-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>{toastMessage}</span>
        </div>
    {/if}

    {#if contextMenu.show}
        <div class="context-menu-glass" role="menu" style="top: {contextMenu.y}px; left: {contextMenu.x}px;" in:scale={{start: 0.95, duration: 150}} out:fade={{duration: 100}} on:click|stopPropagation>
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
            <button class="context-btn" on:click={() => { removeTrackFromPlaylist(contextMenu.track); closeContextMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                Remove from Playlist
            </button>
        </div>
    {/if}
</div>

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
    
    .list-item.active .list-item-num, .list-item.active .list-item-title { color: var(--accent-color); }

    .list-item.just-added {
        animation: playlistPulse 2s ease-out forwards;
    }
    @keyframes playlistPulse {
        0% { background-color: rgba(74, 222, 128, 0.2); box-shadow: inset 0 0 12px rgba(74, 222, 128, 0.15); }
        100% { background-color: transparent; box-shadow: none; }
    }
    
    .swipe-bg-left, .swipe-bg-right { 
        position: absolute; top: 0; bottom: 0; width: 0; 
        z-index: 1; display: flex; align-items: center; 
        border-radius: 8px; overflow: hidden; 
    }
    
    .swipe-bg-left { 
        left: 0; background: rgba(16, 185, 129, 0.4); 
    }
    .swipe-bg-right { 
        right: 0; background: rgba(239, 68, 68, 0.4); 
        justify-content: flex-end; 
    }
    
    .swipe-bg-left svg { margin-left: 20px; flex-shrink: 0; transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1); }
    .swipe-bg-right svg { margin-right: 20px; flex-shrink: 0; transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1); }
    
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
    
    .btn-delete-playlist { color: #ef4444; }
    .btn-delete-playlist.hoverable:hover:not(:disabled) { color: #f87171; }

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
        pointer-events: none;
    }
    .toast-icon { width: 56px; height: 56px; stroke-width: 1.5px; stroke: white; }

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

    /* Modal / Playlist Selector Styles */
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
    .modal-list-item:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.1); }
    .modal-list-item:hover svg { color: var(--accent-color); }

    .btn-add-playlist {
        background: none; border: none; color: rgba(255,255,255,0.3);
        cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        border-radius: 50%;
    }
    .btn-add-playlist.user-remove-track:hover {
        color: #ef4444; background: rgba(239, 68, 68, 0.1);
        transform: scale(1.1);
    }

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