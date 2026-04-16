<script>
    import { currentPlaylist, currentIndex, shuffleHistory, isLowQualityImages, albumsMap, artistsMap } from '../../store.js';
    import { api } from '../api.js';
    import { fade, scale } from 'svelte/transition';

    export let query = '';

    let resultsTracks = [];
    let resultsArtists = [];
    let resultsAlbums = [];
    
    let searchTimeout;
    let isSearching = false;

    let contextMenuOpen = false;
    let contextMenuX = 0;
    let contextMenuY = 0;
    let contextMenuItem = null;
    let contextMenuType = null;

    const DEFAULT_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
    
    const handleImageError = (ev) => { 
        if (ev.target.src !== DEFAULT_PLACEHOLDER) {
            ev.target.src = DEFAULT_PLACEHOLDER; 
        }
    };

    function portal(node) {
        document.body.appendChild(node);
        return { destroy() { if (node.parentNode) node.parentNode.removeChild(node); } };
    }

    $: {
        clearTimeout(searchTimeout);
        const q = query.trim();
        
        if (q === '') {
            resultsTracks = [];
            resultsArtists = [];
            resultsAlbums = [];
            isSearching = false;
        } else {
            isSearching = true;
            searchTimeout = setTimeout(async () => {
                try {
                    const res = await api.fetchWithTimeout(`/Search?q=${encodeURIComponent(q)}`);
                    
                    if (res.ok) {
                        const data = await res.json();
                        
                        const fetchedTracks = (data.tracks || []).map(t => {
                            t.albumId = t.albumId || t.album?.id;
                            if (t.album) {
                                t.album.artistId = t.album.artistId || t.album.artist?.id;
                                t.album.artistName = t.album.artistName || t.album.artist?.name;
                            }
                            return t;
                        });

                        const fetchedArtists = data.artists || [];
                        const fetchedAlbums = data.albums || [];

                        albumsMap.update(m => {
                            fetchedAlbums.forEach(a => m.set(a.id, a));
                            fetchedTracks.forEach(t => {
                                if (t.album && !m.has(t.album.id)) m.set(t.album.id, t.album);
                            });
                            return m;
                        });

                        artistsMap.update(m => {
                            fetchedArtists.forEach(a => m.set(a.id, a));
                            fetchedTracks.forEach(t => {
                                if (t.album?.artist && !m.has(t.album.artist.id)) m.set(t.album.artist.id, t.album.artist);
                            });
                            return m;
                        });

                        resultsTracks = fetchedTracks;
                        resultsArtists = fetchedArtists;
                        resultsAlbums = fetchedAlbums;
                    }
                } catch (err) {
                    console.error(err);
                } finally {
                    isSearching = false;
                }
            }, 300);
        }
    }

    const playTrack = (track) => {
        const indexInResults = resultsTracks.findIndex(t => t.id === track.id);
        if (indexInResults !== -1) {
            shuffleHistory.set([]);
            currentPlaylist.set(resultsTracks);
            currentIndex.set(indexInResults);
        }
    };

    function openContextMenu(e, item, type) {
        contextMenuItem = item;
        contextMenuType = type;
        
        const menuWidth = 220;
        let x = e.clientX;
        if (x + menuWidth > window.innerWidth) {
            x = window.innerWidth - menuWidth - 10;
        }

        contextMenuX = x;
        contextMenuY = e.clientY + 15;
        contextMenuOpen = true;
    }

    function closeContextMenu() {
        contextMenuOpen = false;
        contextMenuItem = null;
        contextMenuType = null;
    }
</script>

<svelte:window on:click={closeContextMenu} />

{#if contextMenuOpen}
    <div use:portal>
        <div class="context-menu" style="top: {contextMenuY}px; left: {contextMenuX}px;" in:scale={{ start: 0.95, duration: 100 }} out:fade={{ duration: 100 }} on:click|stopPropagation>
            <button class="context-item" on:click={() => { if(contextMenuType === 'track') playTrack(contextMenuItem); closeContextMenu(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                Play Now
            </button>
            <button class="context-item" on:click={closeContextMenu}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Add to Queue
            </button>
        </div>
    </div>
{/if}

<div class="search-view">
    {#if query.trim() === ''}
        <div class="empty-state">Type something to search</div>
    {:else if isSearching}
        <div class="empty-state">
            <span class="spinner"></span>
            Searching...
        </div>
    {:else}
        {#if resultsArtists.length > 0}
            <h2>Artists</h2>
            <div class="grid-container">
                {#each resultsArtists as artist}
                    <div class="card artist-card">
                        <a href="#artist/{artist.id}" class="card-link-overlay" aria-label="View {artist.name}"></a>
                        
                        <div class="cover-wrapper artist-wrapper">
                            <img 
                                src={artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath.split('?')[0])}&quality=low` : DEFAULT_PLACEHOLDER} 
                                alt={artist.name} 
                                class="sleek-cover"
                                on:error={handleImageError}
                            />
                        </div>
                        <div class="card-bottom">
                            <div class="card-title">{artist.name}</div>
                            <button class="more-options-btn" aria-label="Artist Options" on:click|preventDefault|stopPropagation={(e) => openContextMenu(e, artist, 'artist')}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="1.5"></circle>
                                    <circle cx="12" cy="5" r="1.5"></circle>
                                    <circle cx="12" cy="19" r="1.5"></circle>
                                </svg>
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}

        {#if resultsAlbums.length > 0}
            <h2>Albums</h2>
            <div class="grid-container">
                {#each resultsAlbums as album}
                    <div class="card album-card">
                        <a href="#album/{album.id}" class="card-link-overlay" aria-label="View {album.title}"></a>

                        <div class="cover-wrapper">
                            <img 
                                src={album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath.split('?')[0])}&quality=low` : DEFAULT_PLACEHOLDER} 
                                alt={album.title} 
                                class="sleek-cover"
                                on:error={handleImageError}
                            />
                        </div>
                        <div class="card-bottom">
                            <div class="card-info-stack">
                                <div class="card-title">{album.title}</div>
                                <div class="card-subtitle">{album.artistName}</div>
                            </div>
                            <button class="more-options-btn" aria-label="Album Options" on:click|preventDefault|stopPropagation={(e) => openContextMenu(e, album, 'album')}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="1.5"></circle>
                                    <circle cx="12" cy="5" r="1.5"></circle>
                                    <circle cx="12" cy="19" r="1.5"></circle>
                                </svg>
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}

        {#if resultsTracks.length > 0}
            <h2>Tracks</h2>
            <div class="track-list">
                {#each resultsTracks as track}
                    <div class="track-item" role="button" tabindex="0" on:click={() => playTrack(track)} on:keydown={(e) => e.key === 'Enter' && playTrack(track)}>
                        <img 
                            src={track.album?.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(track.album.coverPath.split('?')[0])}&quality=low` : DEFAULT_PLACEHOLDER} 
                            alt={track.title} 
                            class="track-thumb sleek-cover"
                            on:error={handleImageError}
                        />
                        <div class="track-info">
                            <div class="track-title">{track.title}</div>
                            <div class="track-artist">{track.album?.artist?.name || 'Unknown Artist'} • {track.album?.title || 'Unknown Album'}</div>
                        </div>
                        <button class="more-options-btn track-options" aria-label="Track Options" on:click|preventDefault|stopPropagation={(e) => openContextMenu(e, track, 'track')}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="1.5"></circle>
                                <circle cx="12" cy="5" r="1.5"></circle>
                                <circle cx="12" cy="19" r="1.5"></circle>
                            </svg>
                        </button>
                    </div>
                {/each}
            </div>
        {/if}

        {#if resultsArtists.length === 0 && resultsAlbums.length === 0 && resultsTracks.length === 0}
            <div class="empty-state">No results found for "{query}"</div>
        {/if}
        
        <div class="keyboard-spacer"></div>
    {/if}
</div>

<style>
    .search-view {
        padding: 24px;
        padding-bottom: 24px; 
    }

    h2 {
        color: var(--text-primary, white);
        margin: 32px 0 16px 0;
        font-size: 24px;
        font-weight: 800;
        letter-spacing: -0.5px;
    }

    h2:first-of-type {
        margin-top: 0;
    }

    .grid-container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 24px;
    }

    .card {
        position: relative;
        text-decoration: none;
        color: inherit;
        display: flex;
        flex-direction: column;
        background: rgba(255,255,255,0.02);
        padding: 16px;
        border-radius: 12px;
        transition: background 0.2s ease;
        outline: none;
    }

    .card-link-overlay {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        z-index: 1;
        border-radius: 12px;
    }

    .card:hover {
        background: rgba(255,255,255,0.08);
    }

    .cover-wrapper {
        width: 100%;
        aspect-ratio: 1;
        margin-bottom: 16px;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    }

    .artist-wrapper {
        border-radius: 50%;
    }

    .sleek-cover { 
        width: 100%; 
        height: 100%; 
        object-fit: cover; 
        transition: all 0.3s ease; 
    }

    .card-bottom { 
        position: relative; 
        display: flex; 
        align-items: center; 
        justify-content: space-between; 
        min-height: 24px;
    }

    .card-info-stack {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        overflow: hidden;
    }

    .card-title { 
        font-weight: 700;
        color: white;
        font-size: 16px;
        flex-grow: 1; 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis; 
        max-width: 100%; 
        transition: max-width 0.2s ease; 
    }
    
    .card-subtitle {
        font-size: 13px;
        color: rgba(255,255,255,0.5);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
    }

    .more-options-btn { 
        position: absolute; 
        right: 0; 
        top: 50%;
        transform: translateY(-50%);
        background: transparent; 
        border: none; 
        color: rgba(255, 255, 255, 0.6); 
        cursor: pointer; 
        padding: 4px; 
        border-radius: 50%; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        opacity: 0; 
        transition: opacity 0.2s ease, background 0.2s ease, color 0.2s ease; 
        z-index: 2;
    }
    .more-options-btn:hover { color: white; background: rgba(255, 255, 255, 0.1); }
    
    .card:hover .card-title, .card:hover .card-info-stack { max-width: calc(100% - 32px); }
    .card:hover .more-options-btn { opacity: 1; }

    .track-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .track-item {
        position: relative;
        display: flex;
        align-items: center;
        padding: 10px 16px;
        background: rgba(255,255,255,0.03);
        border-radius: 8px;
        transition: background 0.2s ease;
        cursor: pointer;
        outline: none;
    }

    .track-item:hover {
        background: rgba(255,255,255,0.08);
    }

    .track-thumb {
        width: 48px;
        height: 48px;
        border-radius: 6px;
        margin-right: 16px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }

    .track-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
        overflow: hidden;
    }

    .track-title {
        color: white;
        font-weight: 600;
        font-size: 15px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-artist {
        font-size: 13px;
        color: rgba(255,255,255,0.5);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-options {
        position: relative;
        transform: none;
        right: auto;
        top: auto;
        opacity: 0;
        z-index: 2;
    }
    .track-item:hover .track-options { opacity: 1; }

    .context-menu { 
        position: fixed; 
        z-index: 9999999; 
        background: rgba(30, 30, 30, 0.75); 
        backdrop-filter: blur(20px) saturate(150%); 
        -webkit-backdrop-filter: blur(20px) saturate(150%); 
        border: 1px solid rgba(255, 255, 255, 0.1); 
        border-radius: 8px; 
        padding: 4px; 
        min-width: 200px; 
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); 
    }
    .context-item { 
        display: flex; 
        align-items: center; 
        gap: 8px; 
        width: 100%; 
        padding: 10px 12px; 
        background: transparent; 
        border: none; 
        color: white; 
        font-size: 13px; 
        font-weight: 500; 
        border-radius: 4px; 
        cursor: pointer; 
        text-align: left; 
        transition: background 0.15s; 
    }
    .context-item:hover { background: rgba(255, 255, 255, 0.1); }

    .empty-state {
        color: rgba(255,255,255,0.4);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        text-align: center;
        padding: 64px 24px;
        font-size: 18px;
        font-weight: 600;
    }
    
    .spinner {
        display: block; width: 24px; height: 24px;
        border: 2px solid rgba(255,255,255,0.12); border-top-color: rgba(255,255,255,0.65);
        border-radius: 50%; animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .keyboard-spacer {
        width: 100%;
        height: 120px;
        margin-top: 32px;
        background-image: 
            linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
        background-size: 20px 20px;
        border-radius: 8px;
        mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
        pointer-events: none;
    }
</style>