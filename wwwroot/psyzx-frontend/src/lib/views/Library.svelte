<script>
    import { artistsMap, appSessionVersion, viewSize } from '../../store.js';
    import { onMount } from 'svelte';
    import { fade, scale } from 'svelte/transition';

    function portal(node) {
        document.body.appendChild(node);
        return { destroy() { if (node.parentNode) node.parentNode.removeChild(node); } };
    }

    const DEFAULT_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
    const handleImageError = (ev) => { ev.target.src = DEFAULT_PLACEHOLDER; };

    $: artistsArray = Array.from($artistsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    let visibleCount = 40;
    $: visibleArtists = artistsArray.slice(0, visibleCount);

    let observerTarget;

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
            if (entries[0].isIntersecting && visibleCount < artistsArray.length) {
                visibleCount += 40;
            }
        }, { rootMargin: '400px' });

        if (observerTarget) observer.observe(observerTarget);

        fetchArtistDuplicates();
        fetchAlbumDuplicates();

        return () => observer.disconnect();
    });

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

    // --- Context Menu Logic ---
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
        const artist = artistsArray.find(a => a.id === id);
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

{#if showModal}
    <div use:portal>
        <div
            class="modal-backdrop"
            style="top: {modalTop}px; height: {modalHeight}px;"
            in:fade={{ duration: 200 }}
            out:fade={{ duration: 150 }}
            on:click={closeModal}
        >
            <div
                class="modal-glass-card"
                in:scale={{ start: 0.95, duration: 250, opacity: 0 }}
                on:click|stopPropagation
            >
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

                            <button
                                class="merge-btn"
                                disabled={mergingIds.has(dup.sourceId)}
                                on:click={() => mergeArtist(dup.sourceId, dup.targetId)}
                                aria-label="Merge {dup.sourceName} into {dup.targetName}"
                            >
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
        <div
            class="modal-backdrop"
            style="top: {modalTop}px; height: {modalHeight}px;"
            in:fade={{ duration: 200 }}
            out:fade={{ duration: 150 }}
            on:click={closeAlbumModal}
        >
            <div
                class="modal-glass-card"
                in:scale={{ start: 0.95, duration: 250, opacity: 0 }}
                on:click|stopPropagation
            >
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

                            <button
                                class="merge-btn album-merge-btn"
                                disabled={mergingAlbumIds.has(dup.sourceId)}
                                on:click={() => mergeAlbum(dup.sourceId, dup.targetId)}
                                aria-label="Merge {dup.sourceName} into {dup.targetName}"
                            >
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
        <div
            class="context-menu"
            style="top: {contextMenuY}px; left: {contextMenuX}px;"
            in:scale={{ start: 0.95, duration: 100 }}
            out:fade={{ duration: 100 }}
            on:click|stopPropagation
        >
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

<div class="grid-container {$viewSize || 'medium'}">
    {#each visibleArtists as artist (artist.id)}
        <div class="card" role="button" tabindex="0" on:click={() => goArtist(artist.id)}>
            <img
                use:smoothLoad
                src={artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath)}&size=thumb` : DEFAULT_PLACEHOLDER}
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

<div bind:this={observerTarget} style="height: 1px; width: 100%;"></div>

<style>
    /* Context Menu Modal */
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
    .context-item.text-danger { color: #ef4444; }
    .context-item.text-danger:hover { background: rgba(239, 68, 68, 0.1); }

    /* Banners */
    .banners-wrapper { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
    .duplicates-banner { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 16px; border-radius: 10px; cursor: pointer; text-align: left; font-size: 13px; transition: background 0.15s; }
    .artist-banner { background: rgba(230, 180, 60, 0.07); border: 0.5px solid rgba(230, 180, 60, 0.3); color: #d4a93a; }
    .artist-banner:hover { background: rgba(230, 180, 60, 0.12); }
    .album-banner { background: rgba(59, 130, 246, 0.07); border: 0.5px solid rgba(59, 130, 246, 0.3); color: #60a5fa; }
    .album-banner:hover { background: rgba(59, 130, 246, 0.12); }
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
    .dup-row:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.08); }
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
    .merge-btn:hover:not(:disabled) { color: #d4a93a; background: rgba(255,255,255,0.07); }
    .album-merge-btn:hover:not(:disabled) { color: #60a5fa; }
    .merge-btn:disabled { cursor: default; opacity: 0.4; }

    /* Spinner */
    .spinner { display: block; width: 20px; height: 20px; border: 1.5px solid rgba(255,255,255,0.12); border-top-color: rgba(255,255,255,0.65); border-radius: 50%; animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Cover animation */
    .sleek-cover { width: 100%; height: 100%; object-fit: cover; opacity: 0; transform: scale(0.92); filter: blur(10px); transition: opacity 0.6s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); will-change: transform, opacity, filter; }
    .sleek-cover.loaded { opacity: 1; transform: scale(1); filter: blur(0); }

    /* --- Card Bottom & 3-Dots Logic --- */
    .card-bottom {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 8px; /* Spacing from the image */
    }

    .card-title {
        flex-grow: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
        transition: max-width 0.2s ease;
    }

    .more-options-btn {
        position: absolute;
        right: 0;
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
    }

    .more-options-btn:hover {
        color: white;
        background: rgba(255, 255, 255, 0.1);
    }

    /* Shrink the title max-width and fade in the button on card hover */
    .card:hover .card-title { max-width: calc(100% - 32px); }
    .card:hover .more-options-btn { opacity: 1; }
</style>