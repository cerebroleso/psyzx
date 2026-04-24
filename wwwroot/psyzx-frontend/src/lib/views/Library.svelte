<script>
    import { artistsMap, albumsMap, appSessionVersion, viewSize, activeDownloads } from '../../store.js';
    import { onMount } from 'svelte';
    import { fade, scale, fly } from 'svelte/transition';

    function portal(node) {
        document.body.appendChild(node);
        return { destroy() { if (node.parentNode) node.parentNode.removeChild(node); } };
    }

    const DEFAULT_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
    const handleImageError = (ev) => { ev.target.src = DEFAULT_PLACEHOLDER; };

    let observerTarget;

    // --- Filter & Sort State ---
    let visibleCount = 40;
    let searchQuery = '';
    let activeSort = 'az'; // az, za, most_albums, most_tracks, most_played, duplicates, recently_added
    let enrichedStats = new Map();
    let libraryViewMode = typeof localStorage !== 'undefined' ? (localStorage.getItem('psyzx_library_view') || 'artists') : 'artists';
    let showSortModal = false;

    // --- Artist Duplicates State ---
    let duplicates = [];
    let showModal = false;
    let mergingIds = new Set();
    let mergedIds  = new Set();

    // --- Album Duplicates State ---
    let albumDuplicates = [];
    let showAlbumModal = false;
    let mergingAlbumIds = new Set();
    let mergedAlbumIds = new Set();

    let modalTop = 0;
    let modalHeight = 0;

    // --- Context Menu State ---
    let contextMenuOpen = false;
    let contextMenuX = 0;
    let contextMenuY = 0;
    let contextMenuArtistId = null;

    onMount(() => {
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && visibleCount < filteredArtists.length) {
                visibleCount += 40;
            }
        }, { rootMargin: '400px' });

        if (observerTarget) observer.observe(observerTarget);

        fetchArtistDuplicates();
        fetchAlbumDuplicates();
        fetchArtistStats();

        return () => observer.disconnect();
    });

    // WS2: Track download state transitions for auto-refresh feedback
    let wasDownloading = false;
    let showDownloadCompleteToast = false;
    let downloadToastTimeout;

    $: if ($activeDownloads.length > 0) {
        wasDownloading = true;
    } else if (wasDownloading && $activeDownloads.length === 0) {
        wasDownloading = false;
        showDownloadCompleteToast = true;
        clearTimeout(downloadToastTimeout);
        downloadToastTimeout = setTimeout(() => { showDownloadCompleteToast = false; }, 4000);
    }

    async function fetchArtistStats() {
        try {
            const res = await fetch('/api/Library/artists/stats');
            if (res.ok) {
                const data = await res.json();
                const map = new Map();
                data.forEach(d => map.set(d.id, d));
                enrichedStats = map;
            }
        } catch { /* silent */ }
    }

    async function fetchArtistDuplicates() {
        try {
            const res = await fetch('/api/Library/duplicates');
            if (res.ok) {
                const data = await res.json();
                const seen = new Set();
                duplicates = data.filter(d => {
                    const key = `${d.sourceId}-${d.targetId}`;
                    if (seen.has(key) || mergedIds.has(d.sourceId)) return false;
                    seen.add(key);
                    return true;
                });
            }
        } catch { /* silent */ }
    }

    async function fetchAlbumDuplicates() {
        try {
            const res = await fetch('/api/Library/duplicate-albums');
            if (res.ok) {
                const data = await res.json();
                const seen = new Set();
                albumDuplicates = data.filter(d => {
                    const key = `${d.sourceId}-${d.targetId}`;
                    if (seen.has(key) || mergedAlbumIds.has(d.sourceId)) return false;
                    seen.add(key);
                    return true;
                });
            }
        } catch { /* silent */ }
    }

    // 🔥 FIX: Cleanly separate value binding from reactive triggers
    // This auto-resets the pagination back to top whenever search or sort changes
    $: if (activeSort || searchQuery !== null) {
        visibleCount = 40;
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // --- Reactive Filter/Sort Engine ---
    $: filteredArtists = Array.from($artistsMap.values())
        .filter(a => {
            if (searchQuery && !a.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            if (activeSort === 'duplicates') {
                return duplicates.some(d => d.sourceId === a.id || d.targetId === a.id);
            }
            return true;
        })
        .sort((a, b) => {
            if (activeSort === 'az') return a.name.localeCompare(b.name);
            if (activeSort === 'za') return b.name.localeCompare(a.name);
            
            const statsA = enrichedStats.get(a.id) || {};
            const statsB = enrichedStats.get(b.id) || {};

            // 🔥 FIX: Added fallback || 0 so missing data never causes NaN sorting failures
            if (activeSort === 'most_albums') {
                const diff = (statsB.albumCount || 0) - (statsA.albumCount || 0);
                return diff !== 0 ? diff : a.name.localeCompare(b.name);
            }
            if (activeSort === 'most_tracks') {
                const diff = (statsB.trackCount || 0) - (statsA.trackCount || 0);
                return diff !== 0 ? diff : a.name.localeCompare(b.name);
            }
            if (activeSort === 'most_played') {
                const diff = (statsB.playCount || 0) - (statsA.playCount || 0);
                return diff !== 0 ? diff : a.name.localeCompare(b.name);
            }
            if (activeSort === 'recently_added') {
                const maxIdA = Math.max(...(Array.from(a.albums || []).map(Number)), 0);
                const maxIdB = Math.max(...(Array.from(b.albums || []).map(Number)), 0);
                return maxIdB - maxIdA;
            }
            
            return 0;
        });

    // --- Album View Sort Engine ---
    $: filteredAlbums = Array.from($albumsMap.values())
        .filter(a => {
            if (searchQuery && !a.title.toLowerCase().includes(searchQuery.toLowerCase()) && !a.artistName?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            return true;
        })
        .sort((a, b) => {
            if (activeSort === 'az') return a.title.localeCompare(b.title);
            if (activeSort === 'za') return b.title.localeCompare(a.title);
            if (activeSort === 'most_played') return (b.playCount || 0) - (a.playCount || 0);
            if (activeSort === 'most_tracks') return (b.tracks?.length || 0) - (a.tracks?.length || 0);
            if (activeSort === 'recently_added') return (b.id || 0) - (a.id || 0);
            return 0;
        });

    $: visibleArtists = filteredArtists.slice(0, visibleCount);

    function lockScroll() {
        const mainView = document.getElementById('main-view');
        if (mainView) {
            modalTop = mainView.scrollTop;
            modalHeight = mainView.clientHeight;
            mainView.style.overflow = 'hidden';
        }
    }

    function unlockScroll() {
        const mainView = document.getElementById('main-view');
        if (mainView) mainView.style.overflow = '';
    }

    function openModal() { lockScroll(); showModal = true; }
    function closeModal() { showModal = false; unlockScroll(); }

    function openAlbumModal() { lockScroll(); showAlbumModal = true; }
    function closeAlbumModal() { showAlbumModal = false; unlockScroll(); }

    async function mergeArtist(sourceId, targetId) {
        mergingIds = new Set([...mergingIds, sourceId]);
        try {
            const res = await fetch('/api/Library/merge-artist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceArtistId: sourceId, targetArtistId: targetId })
            });
            if (res.ok) {
                mergedIds = new Set([...mergedIds, sourceId]);
                duplicates = duplicates.filter(d => d.sourceId !== sourceId);
                if (duplicates.length === 0) closeModal();
            }
        } finally {
            mergingIds = new Set([...mergingIds].filter(id => id !== sourceId));
        }
    }

    async function mergeAlbum(sourceId, targetId) {
        mergingAlbumIds = new Set([...mergingAlbumIds, sourceId]);
        try {
            const res = await fetch('/api/Library/merge-album', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceAlbumId: sourceId, targetAlbumId: targetId })
            });
            if (res.ok) {
                mergedAlbumIds = new Set([...mergedAlbumIds, sourceId]);
                albumDuplicates = albumDuplicates.filter(d => d.sourceId !== sourceId);
                if (albumDuplicates.length === 0) closeAlbumModal();
            }
        } finally {
            mergingAlbumIds = new Set([...mergingAlbumIds].filter(id => id !== sourceId));
        }
    }

    function openContextMenu(e, artistId) {
        e.stopPropagation();
        contextMenuArtistId = artistId;
        
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
        contextMenuArtistId = null;
    }

    async function hardDeleteArtist(id) {
        const artist = Array.from($artistsMap.values()).find(a => a.id === id);
        if (!confirm(`Are you absolutely sure you want to delete '${artist.name}'?\n\nThis will permanently erase the artist, all their albums, and all audio files from your hard drive. This cannot be undone.`)) {
            closeContextMenu();
            return;
        }

        try {
            const res = await fetch(`/api/Library/artist/${id}`, { method: 'DELETE' });
            if (res.ok) {
                artistsMap.update(m => {
                    m.delete(id);
                    return m;
                });
            } else {
                const err = await res.json();
                alert(`Error: ${err.message || 'Failed to delete artist.'}`);
            }
        } catch (e) {
            alert('Network error while deleting artist.');
        }
        closeContextMenu();
    }

    const smoothLoad = (node) => {
        const trigger = () => setTimeout(() => node.classList.add('loaded'), 50);
        if (node.complete) trigger();
        else node.addEventListener('load', trigger);
        return { destroy() { node.removeEventListener('load', trigger); } };
    };

    const goArtist = (id) => { window.location.hash = `#artist/${id}`; };

    const updateViewSize = (size) => {
        viewSize.set(size);
        localStorage.setItem('psyzx_view_size', size);
    };

    const toggleLibraryView = (mode) => {
        libraryViewMode = mode;
        localStorage.setItem('psyzx_library_view', mode);
        visibleCount = 40;
    };

    const sortOptions = [
        { value: 'az', label: 'A to Z', icon: '↓' },
        { value: 'za', label: 'Z to A', icon: '↑' },
        { value: 'most_played', label: 'Most Played', icon: '🔥' },
        { value: 'most_albums', label: 'Most Albums', icon: '💿' },
        { value: 'most_tracks', label: 'Most Tracks', icon: '🎵' },
        { value: 'recently_added', label: 'Recently Added', icon: '🕒' },
        { value: 'duplicates', label: 'Possible Duplicates', icon: '⚠️' },
    ];

    const setSort = (value) => {
        activeSort = value;
        showSortModal = false;
    };

    const goAlbum = (id) => { window.location.hash = `#album/${id}`; };
</script>

<svelte:window on:click={closeContextMenu} />

<div class="banners-wrapper">
    {#if duplicates.length > 0}
        <button
            class="duplicates-banner artist-banner"
            on:click={openModal}
            aria-label="Review {duplicates.length} possible duplicate artist{duplicates.length > 1 ? 's' : ''}"
        >
            <span class="banner-icon">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Z" fill="currentColor"/>
                    <path d="M8 4.75a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4.75ZM8 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" fill="currentColor"/>
                </svg>
            </span>
            <span class="banner-text">
                {duplicates.length} possible duplicate artist{duplicates.length > 1 ? 's' : ''} detected — click to review
            </span>
            <span class="banner-chevron">›</span>
        </button>
    {/if}

    {#if albumDuplicates.length > 0}
        <button
            class="duplicates-banner album-banner"
            on:click={openAlbumModal}
            aria-label="Review {albumDuplicates.length} possible duplicate album{albumDuplicates.length > 1 ? 's' : ''}"
        >
            <span class="banner-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
            </span>
            <span class="banner-text">
                {albumDuplicates.length} possible duplicate album{albumDuplicates.length > 1 ? 's' : ''} detected — click to review
            </span>
            <span class="banner-chevron">›</span>
        </button>
    {/if}
</div>

{#if $activeDownloads.length > 0}
    <div class="download-progress-banner" in:fade={{duration: 200}} out:fade={{duration: 150}}>
        <div class="ios-spinner banner-spinner">
            {#each Array(12) as _, i}
                <div style="transform: rotate({i * 30}deg); animation-delay: {-(1.1 - (i * 0.083))}s;"></div>
            {/each}
        </div>
        <span class="banner-text">Downloading new music... Library will auto-refresh when complete.</span>
    </div>
{/if}

{#if showDownloadCompleteToast}
    <div class="download-complete-toast" in:fly={{y: -20, duration: 300}} out:fade={{duration: 200}}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>Downloads complete — library updated.</span>
    </div>
{/if}

<div class="controls-bar">
    <div class="view-toggle">
        <button class="toggle-btn" class:active={libraryViewMode === 'artists'} on:click={() => toggleLibraryView('artists')} aria-label="Artist View">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            <span>Artists</span>
        </button>
        <button class="toggle-btn" class:active={libraryViewMode === 'albums'} on:click={() => toggleLibraryView('albums')} aria-label="Album View">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="1"></circle></svg>
            <span>Albums</span>
        </button>
    </div>
    
    <button class="sort-trigger" on:click={() => showSortModal = !showSortModal}>
        <span>{sortOptions.find(o => o.value === activeSort)?.label || 'Sort'}</span>
        <svg class="sort-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
    </button>
</div>

{#if showSortModal}
    <div class="sort-modal-backdrop" on:click={() => showSortModal = false} transition:fade={{duration: 150}}>
        <div class="sort-modal-card" on:click|stopPropagation in:scale={{start: 0.95, duration: 200, opacity: 0}}>
            <div class="sort-modal-header">
                <h3>Sort By</h3>
                <button class="btn-close" on:click={() => showSortModal = false} aria-label="Close">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="sort-modal-list">
                {#each sortOptions as opt}
                    {#if !(libraryViewMode === 'albums' && (opt.value === 'most_albums' || opt.value === 'duplicates'))}
                        <button class="sort-option" class:active={activeSort === opt.value} on:click={() => setSort(opt.value)}>
                            <span class="sort-icon">{opt.icon}</span>
                            <span>{opt.label}</span>
                            {#if activeSort === opt.value}
                                <svg class="check-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            {/if}
                        </button>
                    {/if}
                {/each}
            </div>
        </div>
    </div>
{/if}

{#if showModal}
    <div use:portal>
        <div class="modal-backdrop" style="top: {modalTop}px; height: {modalHeight}px;" in:fade={{ duration: 200 }} out:fade={{ duration: 150 }} on:click={closeModal}>
            <div class="modal-glass-card" in:scale={{ start: 0.95, duration: 250, opacity: 0 }} on:click|stopPropagation>
                <div class="modal-header">
                    <h3>Duplicate Artists</h3>
                    <button class="btn-close" on:click={closeModal} aria-label="Close">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="modal-list">
                    {#each duplicates as dup (`${dup.sourceId}-${dup.targetId}`)}
                        <div class="dup-row">
                            <div class="dup-info">
                                <div class="dup-source">{dup.sourceName}</div>
                                <div class="dup-target">→ {dup.targetName}</div>
                                {#if dup.albums && dup.albums.length > 0}
                                    <div class="dup-albums">
                                        {#each dup.albums as album (album.id)}
                                            <span class="album-chip">{album.title}</span>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                            <button class="merge-btn" disabled={mergingIds.has(dup.sourceId)} on:click={() => mergeArtist(dup.sourceId, dup.targetId)}>
                                {#if mergingIds.has(dup.sourceId)}
                                    <span class="spinner" aria-hidden="true"></span>
                                {:else}
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
                                        <path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                    </svg>
                                {/if}
                            </button>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    </div>
{/if}

{#if showAlbumModal}
    <div use:portal>
        <div class="modal-backdrop" style="top: {modalTop}px; height: {modalHeight}px;" in:fade={{ duration: 200 }} out:fade={{ duration: 150 }} on:click={closeAlbumModal}>
            <div class="modal-glass-card" in:scale={{ start: 0.95, duration: 250, opacity: 0 }} on:click|stopPropagation>
                <div class="modal-header">
                    <h3>Duplicate Albums</h3>
                    <button class="btn-close" on:click={closeAlbumModal} aria-label="Close">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="modal-list">
                    {#each albumDuplicates as dup (`${dup.sourceId}-${dup.targetId}`)}
                        <div class="dup-row">
                            {#if dup.coverPath}
                                <img class="dup-thumb" src="{dup.coverPath}" alt="" />
                            {/if}
                            <div class="dup-info">
                                <div class="dup-artist">{dup.artistName}</div>
                                <div class="dup-source">{dup.sourceName} <span class="track-count">({dup.sourceTracks} tracks)</span></div>
                                <div class="dup-target">→ {dup.targetName} <span class="track-count">({dup.targetTracks} tracks)</span></div>
                            </div>
                            <button class="merge-btn album-merge-btn" disabled={mergingAlbumIds.has(dup.sourceId)} on:click={() => mergeAlbum(dup.sourceId, dup.targetId)}>
                                {#if mergingAlbumIds.has(dup.sourceId)}
                                    <span class="spinner" aria-hidden="true"></span>
                                {:else}
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
                                        <path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                    </svg>
                                {/if}
                            </button>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    </div>
{/if}

{#if contextMenuOpen}
    <div use:portal>
        <div class="context-menu" style="top: {contextMenuY}px; left: {contextMenuX}px;" in:scale={{ start: 0.95, duration: 100 }} out:fade={{ duration: 100 }} on:click|stopPropagation>
            <button class="context-item text-danger" on:click={() => hardDeleteArtist(contextMenuArtistId)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
                Delete entirely from Disk
            </button>
        </div>
    </div>
{/if}

{#if libraryViewMode === 'artists'}
    <div class="grid-container {$viewSize || 'medium'}">
        {#each $activeDownloads.filter(d => d.type === 'artist') as dl (dl.id)}
            <div class="card downloading-card">
                <div class="download-overlay">
                    <div class="ios-spinner">
                        {#each Array(12) as _, i}
                            <div style="transform: rotate({i * 30}deg); animation-delay: {-(1.1 - (i * 0.083))}s;"></div>
                        {/each}
                    </div>
                    <div class="dl-name">{dl.name}</div>
                </div>
                {#if dl.coverPath}
                    <img src={dl.coverPath} alt="" class="sleek-cover loaded" />
                {:else}
                    <div class="sleek-cover placeholder-bg loaded"></div>
                {/if}
                <div class="card-bottom"><div class="card-title">{dl.name}</div></div>
            </div>
        {/each}
        {#each visibleArtists as artist (artist.id)}
            <div class="card" role="button" tabindex="0" on:click={() => goArtist(artist.id)}>
                <img
                    use:smoothLoad
                    src={artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath.split('?')[0])}&size=thumb&v=${$appSessionVersion}` : DEFAULT_PLACEHOLDER}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="sleek-cover"
                    on:error={(e) => {
                        handleImageError(e);
                        setTimeout(() => e.target.classList.add('loaded'), 50);
                    }}
                >
                <div class="card-bottom">
                    <div class="card-title">{artist.name}</div>
                    <button class="more-options-btn" aria-label="Artist Options" on:click|stopPropagation={(e) => openContextMenu(e, artist.id)}>
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
{:else}
    <div class="grid-container {$viewSize || 'medium'}">
        {#each $activeDownloads.filter(d => d.type === 'album') as dl (dl.id)}
            <div class="card downloading-card">
                <div class="download-overlay">
                    <div class="ios-spinner">
                        {#each Array(12) as _, i}
                            <div style="transform: rotate({i * 30}deg); animation-delay: {-(1.1 - (i * 0.083))}s;"></div>
                        {/each}
                    </div>
                    <div class="dl-name">{dl.name}</div>
                </div>
                {#if dl.coverPath}
                    <img src={dl.coverPath} alt="" class="sleek-cover loaded" />
                {:else}
                    <div class="sleek-cover placeholder-bg loaded"></div>
                {/if}
                <div class="card-bottom"><div class="card-title">{dl.name}</div></div>
            </div>
        {/each}
        {#each filteredAlbums.slice(0, visibleCount) as album (album.id)}
            <div class="card" role="button" tabindex="0" on:click={() => goAlbum(album.id)}>
                <img
                    use:smoothLoad
                    src={album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath.split('?')[0])}&size=thumb&v=${$appSessionVersion}` : DEFAULT_PLACEHOLDER}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="sleek-cover"
                    on:error={(e) => {
                        handleImageError(e);
                        setTimeout(() => e.target.classList.add('loaded'), 50);
                    }}
                >
                <div class="card-bottom">
                    <div class="card-title">{album.title}</div>
                    <div class="card-subtitle">{album.artistName || 'Unknown Artist'}</div>
                </div>
            </div>
        {/each}
    </div>
{/if}

<div bind:this={observerTarget} style="height: 1px; width: 100%;"></div>

<style>
    /* --- Library Controls --- */
    .controls-bar {
        display: flex;
        gap: 16px;
        margin-bottom: 24px;
        align-items: center;
        flex-wrap: wrap;
    }

    .search-wrapper {
        position: relative;
        flex: 1;
        min-width: 200px;
    }

    .search-wrapper svg {
        position: absolute;
        left: 14px;
        top: 50%;
        transform: translateY(-50%);
        color: rgba(255, 255, 255, 0.4);
    }

    .search-wrapper input {
        width: 100%;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: white;
        padding: 12px 14px 12px 42px;
        border-radius: 12px;
        font-size: 14px;
        outline: none;
        transition: all 0.2s ease;
    }

    .search-wrapper input:focus {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.2);
    }

    /* --- View Toggle --- */
    .view-toggle {
        display: flex;
        gap: 0;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        overflow: hidden;
    }
    .toggle-btn {
        display: flex; align-items: center; gap: 6px;
        padding: 10px 16px;
        background: transparent;
        border: none;
        color: var(--text-secondary, rgba(255,255,255,0.5));
        font-size: 13px; font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    .toggle-btn.active {
        background: rgba(255,255,255,0.1);
        color: var(--text-primary, white);
    }
    @media (hover: hover) {
        .toggle-btn:hover:not(.active) { background: rgba(255,255,255,0.06); }
    }

    /* --- Sort Trigger Button --- */
    .sort-trigger {
        display: flex; align-items: center; gap: 6px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: white;
        padding: 10px 16px;
        border-radius: 12px;
        font-size: 13px; font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-left: auto;
    }
    .sort-trigger:hover { background: rgba(255,255,255,0.08); }

    .sort-chevron {
        color: rgba(255, 255, 255, 0.5);
        flex-shrink: 0;
    }

    /* --- Sort Modal --- */
    .sort-modal-backdrop {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
        z-index: 999999;
        display: flex; align-items: center; justify-content: center;
    }
    .sort-modal-card {
        background: rgba(20, 20, 20, 0.9);
        backdrop-filter: blur(40px) saturate(150%);
        -webkit-backdrop-filter: blur(40px) saturate(150%);
        border: 1px solid rgba(255,255,255,0.1);
        border-top: 1px solid rgba(255,255,255,0.2);
        border-radius: 20px;
        padding: 20px;
        width: 90%; max-width: 340px;
        box-shadow: 0 24px 48px rgba(0,0,0,0.5);
    }
    .sort-modal-header {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 16px;
    }
    .sort-modal-header h3 {
        margin: 0; color: white; font-weight: 800; font-size: 18px;
    }
    .sort-modal-list {
        display: flex; flex-direction: column; gap: 4px;
    }
    .sort-option {
        display: flex; align-items: center; gap: 12px;
        padding: 12px 14px;
        background: transparent;
        border: none; border-radius: 10px;
        color: var(--text-secondary, rgba(255,255,255,0.6));
        font-size: 14px; font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: left;
    }
    .sort-option.active {
        color: var(--text-primary, white);
        background: rgba(255,255,255,0.06);
    }
    .sort-option:hover { background: rgba(255,255,255,0.08); color: white; }
    .sort-icon { font-size: 16px; width: 24px; text-align: center; }
    .check-icon { margin-left: auto; flex-shrink: 0; }

    /* --- Download Overlay & iOS Spinner --- */
    .downloading-card {
        pointer-events: none;
        position: relative;
    }
    .download-overlay {
        position: absolute; inset: 0;
        background: rgba(0,0,0,0.6);
        border-radius: 12px;
        z-index: 10;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 12px;
    }
    .dl-name {
        font-size: 11px; font-weight: 700;
        color: rgba(255,255,255,0.7);
        text-align: center;
        max-width: 80%;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .placeholder-bg {
        background: rgba(255,255,255,0.05);
        aspect-ratio: 1;
        border-radius: 8px;
    }
    .ios-spinner {
        position: relative;
        width: 32px; height: 32px;
    }
    .ios-spinner > div {
        position: absolute;
        width: 2.5px; height: 8px;
        background: rgba(255,255,255,0.85);
        border-radius: 2px;
        left: 50%; top: 50%;
        margin-left: -1.25px; margin-top: -16px;
        transform-origin: 50% 16px;
        animation: ios-fade 1.1s infinite linear;
    }
    @keyframes ios-fade {
        0%, 39%, 100% { opacity: 0.15; }
        40% { opacity: 1; }
    }

    /* Card subtitle for album view */
    .card-subtitle {
        font-size: 12px;
        color: var(--text-secondary, rgba(255,255,255,0.5));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
    }

    /* Context Menu Modal */
    .context-menu { position: fixed; z-index: 9999999; background: rgba(30, 30, 30, 0.75); backdrop-filter: blur(20px) saturate(150%); -webkit-backdrop-filter: blur(20px) saturate(150%); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 4px; min-width: 200px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); }
    .context-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; background: transparent; border: none; color: white; font-size: 13px; font-weight: 500; border-radius: 4px; cursor: pointer; text-align: left; transition: background 0.15s; }
    .context-item.text-danger { color: #ef4444; }
    @media (hover: hover) {
        .context-item:hover { background: rgba(255, 255, 255, 0.1); }
        .context-item.text-danger:hover { background: rgba(239, 68, 68, 0.1); }
    }

    /* Banners */
    .banners-wrapper { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
    .duplicates-banner { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 16px; border-radius: 10px; cursor: pointer; text-align: left; font-size: 13px; transition: background 0.15s; }
    .artist-banner { background: rgba(230, 180, 60, 0.07); border: 0.5px solid rgba(230, 180, 60, 0.3); color: #d4a93a; }
    @media (hover: hover) {
        .artist-banner:hover { background: rgba(230, 180, 60, 0.12); }
    }
    .album-banner { background: rgba(59, 130, 246, 0.07); border: 0.5px solid rgba(59, 130, 246, 0.3); color: #60a5fa; }
    @media (hover: hover) {
        .album-banner:hover { background: rgba(59, 130, 246, 0.12); }
    }
    .banner-icon { flex-shrink: 0; display: flex; align-items: center; }
    .banner-text { flex: 1; font-weight: 500; }
    .banner-chevron { font-size: 17px; opacity: 0.55; }

    /* Modal */
    .modal-backdrop { position: absolute; left: 0; width: 100%; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 999999; display: flex; align-items: center; justify-content: center; }
    .modal-glass-card { background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(40px) saturate(150%); -webkit-backdrop-filter: blur(40px) saturate(150%); border: 1px solid rgba(255, 255, 255, 0.1); border-top: 1px solid rgba(255, 255, 255, 0.25); border-radius: 24px; padding: 24px; width: 90%; max-width: 450px; box-shadow: 0 32px 64px rgba(0, 0, 0, 0.5); max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-shrink: 0; }
    .modal-header h3 { margin: 0; color: white; font-weight: 800; font-size: 20px; }
    .btn-close { background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; padding: 4px; border-radius: 50%; transition: all 0.2s; }
    .btn-close:hover { color: white; background: rgba(255,255,255,0.1); }
    .modal-list { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
    .dup-row { display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.03); border: 1px solid transparent; border-radius: 12px; padding: 14px 16px; transition: background 0.2s, border-color 0.2s; }
    @media (hover: hover) {
        .dup-row:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.08); }
    }
    .dup-thumb { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
    .dup-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .dup-artist { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent-color, #60a5fa); font-weight: 700; margin-bottom: 2px; }
    .dup-source { font-size: 15px; font-weight: 600; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dup-target { font-size: 12px; color: rgba(255,255,255,0.4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .track-count { opacity: 0.5; font-weight: normal; font-size: 0.9em; }
    .dup-albums { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .album-chip { font-size: 10px; color: rgba(255,255,255,0.35); background: rgba(255,255,255,0.05); border: 0.5px solid rgba(255,255,255,0.08); border-radius: 4px; padding: 2px 6px; white-space: nowrap; }

    /* Merge button */
    .merge-btn { background: none; border: none; color: rgba(255,255,255,0.3); cursor: pointer; padding: 6px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: color 0.2s, background 0.2s; }
    @media (hover: hover) {
        .merge-btn:hover:not(:disabled) { color: #d4a93a; background: rgba(255,255,255,0.07); }
    }
    .album-merge-btn:hover:not(:disabled) { color: #60a5fa; }
    .merge-btn:disabled { cursor: default; opacity: 0.4; }

    /* Spinner */
    .spinner { display: block; width: 20px; height: 20px; border: 1.5px solid rgba(255,255,255,0.12); border-top-color: rgba(255,255,255,0.65); border-radius: 50%; animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Cover animation */
    .sleek-cover { width: 100%; height: 100%; object-fit: cover; opacity: 0; transform: scale(0.92); filter: blur(10px); transition: opacity 0.6s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); will-change: transform, opacity, filter; }
    .sleek-cover.loaded { opacity: 1; transform: scale(1); filter: blur(0); }

    /* --- Card Bottom & 3-Dots Logic --- */
    .card-bottom { position: relative; display: flex; flex-direction: column; margin-top: 8px; }
    .card-title { flex-grow: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; transition: max-width 0.2s ease; }
    .more-options-btn { position: absolute; right: 0; top: 0; background: transparent; border: none; color: rgba(255, 255, 255, 0.6); cursor: pointer; padding: 4px; border-radius: 50%; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s ease, background 0.2s ease, color 0.2s ease; }
    .more-options-btn:hover { color: white; background: rgba(255, 255, 255, 0.1); }
    @media (hover: hover) {
        .card:hover .card-title { max-width: calc(100% - 32px); }
        .card:hover .more-options-btn { opacity: 1; }
    }

    /* WS2: Download progress banner */
    .download-progress-banner {
        display: flex; align-items: center; gap: 12px;
        padding: 12px 16px; margin-bottom: 16px;
        background: rgba(59, 130, 246, 0.08);
        border: 0.5px solid rgba(59, 130, 246, 0.25);
        border-radius: 12px; color: #60a5fa;
        font-size: 13px; font-weight: 500;
        animation: pulse-border 2s ease-in-out infinite;
    }
    @keyframes pulse-border {
        0%, 100% { border-color: rgba(59, 130, 246, 0.25); }
        50% { border-color: rgba(59, 130, 246, 0.55); }
    }
    .banner-spinner { width: 20px; height: 20px; flex-shrink: 0; }
    .banner-spinner > div { width: 2px; height: 6px; margin-top: -12px; }

    /* WS2: Download complete toast */
    .download-complete-toast {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 18px; margin-bottom: 16px;
        background: rgba(34, 197, 94, 0.1);
        border: 0.5px solid rgba(34, 197, 94, 0.35);
        border-radius: 12px; color: #4ade80;
        font-size: 13px; font-weight: 600;
    }
</style>