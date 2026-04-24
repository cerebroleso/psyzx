<script>
    import { onMount } from 'svelte';
    import { fade, scale, fly } from 'svelte/transition';
    import { api } from '../api.js';
    import { playlistUpdateSignal, appSessionVersion } from '../../store.js';

    let userPlaylists = [];
    let showCreateModal = false;
    let newPlaylistName = '';
    let isCreating = false;

    $: if ($playlistUpdateSignal || true) {
        loadPlaylists();
    }

    async function loadPlaylists() {
        try {
            userPlaylists = await api.getPlaylists();
        } catch (e) {
            console.error(e);
        }
    }

    function portal(node) {
        document.body.appendChild(node);
        return {
            destroy() {
                if (node.parentNode) node.parentNode.removeChild(node);
            }
        };
    }

    const openCreateModal = () => {
        newPlaylistName = '';
        showCreateModal = true;
        document.body.style.overflow = 'hidden';
        
        setTimeout(() => {
            const input = document.getElementById('playlist-name-input');
            if (input) input.focus();
        }, 100);
    };

    const closeCreateModal = () => {
        showCreateModal = false;
        document.body.style.overflow = '';
    };

    const executeCreate = async () => {
        if (!newPlaylistName.trim()) return;
        isCreating = true;
        try {
            const newPl = await api.createPlaylist(newPlaylistName.trim());
            userPlaylists = [...userPlaylists, newPl];
            closeCreateModal();
        } catch (e) {
            console.error(e);
            alert("Failed to create playlist. Is the backend running?");
        } finally {
            isCreating = false;
        }
    };

    // WS1: Drag-and-drop onto playlist cards
    let dragHoveredPlaylistId = null;
    let pendingDropTrackIds = null;
    let showDropToast = false;
    let dropToastText = '';
    let dropToastTimeout;

    const onCardDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const onCardDragEnter = (e, playlistId) => { e.preventDefault(); dragHoveredPlaylistId = playlistId; };
    const onCardDragLeave = () => { dragHoveredPlaylistId = null; };

    const onCardDrop = async (e, playlist) => {
        e.preventDefault();
        dragHoveredPlaylistId = null;
        try {
            const trackIds = JSON.parse(e.dataTransfer.getData('text/plain'));
            await addTracksToPlaylistAndToast(playlist, trackIds);
        } catch {}
    };

    const addTracksToPlaylistAndToast = async (playlist, trackIds) => {
        if (!trackIds || trackIds.length === 0) return;
        const count = await api.addTracksToPlaylist(playlist.id, trackIds);
        if (count > 0) {
            dropToastText = `Added ${count} track${count > 1 ? 's' : ''} to "${playlist.name}"`;
            showDropToast = true;
            clearTimeout(dropToastTimeout);
            dropToastTimeout = setTimeout(() => { showDropToast = false; }, 3000);
            loadPlaylists();
        }
    };

    // WS1: Listen for pending drops from Sidebar
    const handlePendingDrop = (e) => {
        pendingDropTrackIds = e.detail?.trackIds || null;
    };

    onMount(() => {
        window.addEventListener('playlist-drop-pending', handlePendingDrop);
        return () => window.removeEventListener('playlist-drop-pending', handlePendingDrop);
    });

    // If we have pending track IDs and user clicks a playlist card, add them
    const handlePendingClick = async (playlist) => {
        if (pendingDropTrackIds && pendingDropTrackIds.length > 0) {
            await addTracksToPlaylistAndToast(playlist, pendingDropTrackIds);
            pendingDropTrackIds = null;
        } else {
            // Normal navigation
            window.location.hash = `#playlist/${playlist.id}`;
        }
    };
</script>

<div class="playlists-container" in:fade={{duration: 200}}>
    <h1 style="color: white; font-weight: 800; font-size: 28px; margin-bottom: 24px; letter-spacing: -1px;">Your Playlists</h1>
    
    <div class="grid-container">
        <div class="card add-card" role="button" tabindex="0" on:click={openCreateModal} on:keydown={(e) => e.key === 'Enter' && openCreateModal()}>
            <div class="add-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </div>
            <div class="card-info">
                <div class="title">Create Playlist</div>
            </div>
        </div>

        {#each userPlaylists as playlist}
            <a 
                href="#playlist/{playlist.id}" 
                class="card playlist-card" 
                class:drag-hover={dragHoveredPlaylistId === playlist.id || pendingDropTrackIds}
                on:click|preventDefault={() => handlePendingClick(playlist)}
                on:dragover={onCardDragOver}
                on:dragenter={(e) => onCardDragEnter(e, playlist.id)}
                on:dragleave={onCardDragLeave}
                on:drop={(e) => onCardDrop(e, playlist)}
            >
                <div class="playlist-cover-wrapper">
                    {#if playlist.covers && playlist.covers.length >= 4}
                        <div class="dynamic-grid-cover">
                            {#each playlist.covers as cover}
                                <img src="/api/Tracks/image?path={encodeURIComponent(cover.split('?')[0])}&v={$appSessionVersion}" alt="Cover fragment" />
                            {/each}
                        </div>
                    {:else if playlist.covers && playlist.covers.length > 0}
                        <img src="/api/Tracks/image?path={encodeURIComponent(playlist.covers[0].split('?')[0])}&v={$appSessionVersion}" class="single-cover" alt="Playlist Cover" />
                    {:else}
                        <div class="empty-cover">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                        </div>
                    {/if}
                </div>
                <div class="card-info">
                    <div class="title">{playlist.name}</div>
                    <div class="subtitle">{playlist.trackCount} tracks</div>
                </div>
            </a>
        {/each}
    </div>
</div>

{#if showDropToast}
    <div class="drop-toast" in:fly={{y: 20, duration: 300}} out:fade={{duration: 200}}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>{dropToastText}</span>
    </div>
{/if}

{#if pendingDropTrackIds}
    <div class="pending-drop-hint" in:fly={{y: 20, duration: 300}} out:fade={{duration: 200}}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>Click a playlist to add {pendingDropTrackIds.length} track{pendingDropTrackIds.length > 1 ? 's' : ''}</span>
        <button class="dismiss-btn" on:click={() => pendingDropTrackIds = null}>✕</button>
    </div>
{/if}

{#if showCreateModal}
    <div class="modal-backdrop" role="button" tabindex="-1" use:portal in:fade={{duration: 200}} out:fade={{duration: 150}} on:click={closeCreateModal} on:keydown={(e) => e.key === 'Escape' && closeCreateModal()}>
        <div class="modal-glass-card" role="dialog" aria-modal="true" in:scale={{start: 0.95, duration: 250, opacity: 0}} on:click|stopPropagation>
            <div class="modal-header">
                <h3>New Playlist</h3>
                <button class="btn-close" aria-label="Close" on:click={closeCreateModal}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            
            <form on:submit|preventDefault={executeCreate} class="create-form">
                <input type="text" id="playlist-name-input" bind:value={newPlaylistName} placeholder="" required disabled={isCreating} autocomplete="off">
                <button type="submit" class="btn-submit" disabled={isCreating || !newPlaylistName.trim()}>
                    {isCreating ? 'Creating...' : 'Create'}
                </button>
            </form>
        </div>
    </div>
{/if}

<style>
    .playlists-container { padding: 24px; padding-bottom: 120px; }

    .grid-container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 24px;
    }

    .card {
        text-decoration: none; color: inherit; display: flex; flex-direction: column;
        background: rgba(255,255,255,0.02); padding: 16px; border-radius: 12px;
        transition: transform 0.2s ease, background 0.2s ease; cursor: pointer;
    }
    
    .card:hover { background: rgba(255,255,255,0.08); }

    .playlist-cover-wrapper, .add-icon {
        width: 100%; aspect-ratio: 1; border-radius: 8px; margin-bottom: 16px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.3); color: rgba(255,255,255,0.5);
        box-shadow: 0 8px 24px rgba(0,0,0,0.3); overflow: hidden;
    }

    .dynamic-grid-cover {
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr;
        width: 100%; height: 100%;
    }
    .dynamic-grid-cover img { width: 100%; height: 100%; object-fit: cover; }
    
    .single-cover { width: 100%; height: 100%; object-fit: cover; }
    .empty-cover { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.2); }

    .add-icon { border: 2px dashed rgba(255,255,255,0.2); background: transparent; transition: all 0.2s; }
    .add-card:hover .add-icon { border-color: var(--accent-color); color: var(--accent-color); background: rgba(255,255,255,0.05); }

    .title { font-weight: 700; color: white; font-size: 16px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .subtitle { font-size: 14px; color: rgba(255,255,255,0.5); }

    .modal-backdrop {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
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

    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .modal-header h3 { margin: 0; color: white; font-weight: 800; font-size: 20px; }
    
    .btn-close { background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; padding: 4px; border-radius: 50%; transition: all 0.2s; }
    .btn-close:hover { color: white; background: rgba(255,255,255,0.1); }

    .create-form { display: flex; flex-direction: column; gap: 16px; }
    .create-form input {
        width: 100%; padding: 14px 16px; background: rgba(0, 0, 0, 0.3); color: white;
        border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; font-size: 15px; outline: none; transition: all 0.2s;
    }
    .create-form input:focus { border-color: var(--accent-color); background: rgba(0,0,0,0.5); box-shadow: inset 0 2px 4px rgba(0,0,0,0.2); }
    
    .btn-submit {
        background: var(--accent-color); color: black; border: none; padding: 14px;
        font-size: 15px; font-weight: bold; border-radius: 12px; cursor: pointer; transition: all 0.2s;
    }
    .btn-submit:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.1); }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; filter: grayscale(0.5); }

    /* WS1: Drag hover glow on playlist cards */
    .playlist-card.drag-hover {
        background: rgba(96, 165, 250, 0.08) !important;
        box-shadow: 0 0 0 2px var(--accent-color, #60a5fa), 0 8px 24px rgba(0,0,0,0.3) !important;
        transform: scale(1.02);
    }

    /* Drop toast */
    .drop-toast {
        position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
        display: flex; align-items: center; gap: 10px;
        padding: 12px 20px; background: rgba(34, 197, 94, 0.15);
        border: 1px solid rgba(34, 197, 94, 0.35);
        backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        border-radius: 14px; color: #4ade80;
        font-size: 14px; font-weight: 600;
        z-index: 99999; white-space: nowrap;
    }

    /* Pending drop hint bar */
    .pending-drop-hint {
        position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
        display: flex; align-items: center; gap: 10px;
        padding: 12px 20px; background: rgba(96, 165, 250, 0.12);
        border: 1px solid rgba(96, 165, 250, 0.3);
        backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        border-radius: 14px; color: #60a5fa;
        font-size: 14px; font-weight: 600;
        z-index: 99999; white-space: nowrap;
    }
    .dismiss-btn {
        background: none; border: none; color: rgba(255,255,255,0.4);
        cursor: pointer; padding: 2px 4px; font-size: 14px;
        margin-left: 4px;
    }
</style>