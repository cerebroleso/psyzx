<script>
    import { onMount } from 'svelte';
    import { fade, scale } from 'svelte/transition';
    import { api } from '../api.js';

    let userPlaylists = [];
    let showCreateModal = false;
    let newPlaylistName = '';
    let isCreating = false;

    onMount(async () => {
        try {
            userPlaylists = await api.getPlaylists();
        } catch (e) {
            console.error(e);
        }
    });

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
            <a href="#playlist/{playlist.id}" class="card playlist-card">
                <div class="playlist-cover-wrapper">
                    {#if playlist.covers && playlist.covers.length >= 4}
                        <div class="dynamic-grid-cover">
                            {#each playlist.covers as cover}
                                <img src="/api/Tracks/image?path={encodeURIComponent(cover)}" alt="Cover fragment" />
                            {/each}
                        </div>
                    {:else if playlist.covers && playlist.covers.length > 0}
                        <img src="/api/Tracks/image?path={encodeURIComponent(playlist.covers[0])}" class="single-cover" alt="Playlist Cover" />
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

{#if showCreateModal}
    <div class="modal-backdrop" use:portal in:fade={{duration: 200}} out:fade={{duration: 150}} on:click={closeCreateModal}>
        <div class="modal-glass-card" in:scale={{start: 0.95, duration: 250, opacity: 0}} on:click|stopPropagation>
            <div class="modal-header">
                <h3>New Playlist</h3>
                <button class="btn-close" on:click={closeCreateModal}>
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
</style>