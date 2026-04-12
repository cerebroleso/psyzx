<script>
    import { fade, fly, scale } from 'svelte/transition';
    import { 
        artistsMap, 
        albumsMap, 
        appSessionVersion, 
        isMaxGlassActive, 
        viewSize,
        currentPlaylist,
        currentIndex,
        isShuffle 
    } from '../../store.js';
    import { api } from '../api.js';

    export let artistId;

    const DEFAULT_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
    const handleImageError = (ev) => {
        ev.target.src = DEFAULT_PLACEHOLDER;
    };

    const portal = (node) => {
        document.body.appendChild(node);
        return {
            destroy() {
                if (node.parentNode) node.parentNode.removeChild(node);
            }
        };
    };

    $: artist = $artistsMap.get(parseInt(artistId));
    $: artistAlbums = artist ? Array.from(artist.albums).map(id => $albumsMap.get(id)) : [];
    
    let isEditing = false;
    let editName = '';
    let editImage = '';
    let previewImage = '';
    let fileInput;

    // --- Context Menu State ---
    let contextMenuOpen = false;
    let contextMenuX = 0;
    let contextMenuY = 0;
    let contextMenuAlbumId = null;

    // --- Add Missing Album State ---
    let showAddAlbumModal = false;
    let newAlbumInput = '';

    const toggleEdit = () => {
        if (!isEditing) {
            editName = artist.name;
            editImage = artist.imagePath || '';
            previewImage = artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath)}&v=${$appSessionVersion}` : '';
        }
        isEditing = !isEditing;
    };

    const toggleAddAlbumModal = () => {
        showAddAlbumModal = !showAddAlbumModal;
        newAlbumInput = '';
    };

    let selectedFile = null;

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        selectedFile = file;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            previewImage = event.target.result; 
        };
        reader.readAsDataURL(file);
    };

    const saveArtist = async () => {
        if (!editName.trim()) return;

        const formData = new FormData();
        formData.append('name', editName);
        
        if (selectedFile) {
            formData.append('imageFile', selectedFile);
        }

        const success = await api.updateArtist(artist.id, formData);
        
        if (success) {
            artistsMap.update(map => {
                const a = map.get(parseInt(artistId));
                if (a) { 
                    a.name = editName;
                    if (selectedFile) window.location.reload(); 
                }
                return map;
            });
            appSessionVersion.set(Date.now()); 
            isEditing = false;
            selectedFile = null;
        } else {
            alert("Errore durante il salvataggio.");
        }
    };

    const goAlbum = (id) => { window.location.hash = `#album/${id}`; };

    const updateViewSize = (size) => {
        viewSize.set(size);
        localStorage.setItem('psyzx_view_size', size);
    };

    // --- Context Menu Logic ---
    function openContextMenu(e, albumId) {
        e.stopPropagation();
        contextMenuAlbumId = albumId;
        
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
        contextMenuAlbumId = null;
    }

    async function hardDeleteAlbum(id) {
        const albumToDelete = artistAlbums.find(a => a.id === id);
        if (!confirm(`Are you absolutely sure you want to delete '${albumToDelete.title}'?\n\nThis will permanently erase the album and all audio files from your hard drive. This cannot be undone.`)) {
            closeContextMenu();
            return;
        }

        try {
            const res = await fetch(`/api/Library/album/${id}`, { method: 'DELETE' });
            if (res.ok) {
                albumsMap.update(m => { m.delete(id); return m; });
                artistsMap.update(m => {
                    const a = m.get(parseInt(artistId));
                    if (a && a.albums) {
                        a.albums.delete(id);
                    }
                    return m;
                });
            } else {
                const err = await res.json();
                alert(`Error: ${err.message || 'Failed to delete album.'}`);
            }
        } catch (e) {
            alert('Network error while deleting album.');
        }
        closeContextMenu();
    }

    // --- Action Buttons Logic ---
    const shuffleArtist = () => {
        if (!artistAlbums || artistAlbums.length === 0) return;

        let allTracks = [];
        
        artistAlbums.forEach(album => {
            if (album && album.tracks) {
                allTracks.push(...Array.from(album.tracks));
            }
        });

        allTracks = allTracks.filter(t => t && typeof t === 'object');

        if (allTracks.length === 0) {
            alert("No tracks found to shuffle.");
            return;
        }

        for (let i = allTracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
        }

        isShuffle.set(true);
        currentPlaylist.set(allTracks);
        currentIndex.set(0); 
    };

    const downloadArtist = () => {
        console.log(`Triggering download for all albums by artist: ${artist.name}`);
        alert(`MOCK: Sent request to download ${artist.albums.size} album(s) from ${artist.name}.`);
    };

    const submitMissingAlbum = async () => {
        if (!newAlbumInput.trim()) return;

        let query = newAlbumInput.trim();
        
        // 1. Force the user to use an actual URL. Text searches result in 1-hour compilations.
        if (!query.startsWith('http://') && !query.startsWith('https://')) {
            alert('To avoid downloading 1-hour single compilation tracks, please paste a direct YouTube Playlist or Spotify Album URL.');
            return;
        }

        // 2. Reject single YouTube videos without a playlist ID attached.
        if ((query.includes('youtube.com') || query.includes('youtu.be')) && !query.includes('list=')) {
            alert('Single YouTube videos are blocked. Please provide a YouTube Playlist link (the URL must contain "list=").');
            return;
        }

        try {
            const res = await fetch('/api/System/ytdlp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    url: query,
                    targetArtist: artist.name 
                })
            });

            if (res.ok) {
                alert('Playlist added to download queue!');
                toggleAddAlbumModal();
            } else {
                const data = await res.json();
                alert(`Error: ${data.text || 'Failed to queue album'}`);
            }
        } catch (err) {
            alert('Network error while queueing album.');
        }
    };
</script>

<svelte:window on:click={closeContextMenu} />

{#if artist}
<div class="fade-bg"></div>
<div class="album-hero">
    <div class="cover-wrapper artist-wrapper" role="button" tabindex="0" on:click={toggleEdit} on:keydown={(e) => e.key === 'Enter' && toggleEdit()}>
        <img 
            src={artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath)}&v=${$appSessionVersion}` : DEFAULT_PLACEHOLDER} 
            alt=""
            on:error={handleImageError}
        >        
        <div class="edit-overlay-circle">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
        </div>
    </div>
    
    <div class="album-info">
        <div class="album-type">Artist</div>
        <div class="album-title">{artist.name}</div>
        <div class="album-meta"><span>{artist.albums.size} albums</span></div>
        
        <div class="artist-actions">
            <button class="btn-primary" on:click={shuffleArtist} aria-label="Shuffle Artist">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4"/></svg>
                Shuffle
            </button>
            <button class="btn-secondary" on:click={downloadArtist} aria-label="Download Artist">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download
            </button>
        </div>
    </div>
</div>

<div class="grid-container {$viewSize || 'medium'}">
    {#each artistAlbums as album (album.id)}
        <div class="card" role="button" tabindex="0" on:click={() => goAlbum(album.id)} on:keydown={(e) => e.key === 'Enter' && goAlbum(album.id)}>
            <img 
                src={album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&v=${$appSessionVersion}` : DEFAULT_PLACEHOLDER} 
                alt=""
                on:error={handleImageError}
            >            
            <div class="card-bottom">
                <div class="card-title">{album.title}</div>
                <button class="more-options-btn" aria-label="More options" on:click|stopPropagation={(e) => openContextMenu(e, album.id)}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="1.5"></circle>
                        <circle cx="12" cy="5" r="1.5"></circle>
                        <circle cx="12" cy="19" r="1.5"></circle>
                    </svg>
                </button>
            </div>
        </div>
    {/each}

    <div class="card add-album-card" role="button" tabindex="0" on:click={toggleAddAlbumModal} on:keydown={(e) => e.key === 'Enter' && toggleAddAlbumModal()}>
        <div class="add-album-content">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span style="font-weight: 600; font-size: 14px;">Add Album</span>
        </div>
    </div>
</div>

{#if contextMenuOpen}
    <div use:portal>
        <div
            class="context-menu"
            style="top: {contextMenuY}px; left: {contextMenuX}px;"
            in:scale={{ start: 0.95, duration: 100 }}
            out:fade={{ duration: 100 }}
            on:click|stopPropagation
        >
            <button class="context-item text-danger" on:click={() => hardDeleteAlbum(contextMenuAlbumId)}>
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

{#if showAddAlbumModal}
    <div use:portal>
        <div
            class="add-modal-backdrop"
            transition:fade={{duration: 200}}
            on:click|self={toggleAddAlbumModal}
        >
            <div class="modal-glass-card" transition:scale={{ start: 0.95, duration: 200 }}>
                <div class="edit-header" style="margin-bottom: 20px;">Add Missing Album</div>
                
                <div class="form-group">
                    <label>Album Name or URL</label>
                    <input 
                        type="text" 
                        class="sleek-input" 
                        placeholder="e.g. The Wall or Spotify URL" 
                        bind:value={newAlbumInput} 
                        on:keydown={(e) => e.key === 'Enter' && submitMissingAlbum()}
                        autofocus
                    />
                    <small style="color: rgba(255,255,255,0.5); font-size: 11px; margin-top: 4px;">
                        Enter a direct link or just type the name to auto-search.
                    </small>
                </div>

                <div style="display: flex; gap: 12px; margin-top: 24px;">
                    <button class="btn-save" on:click={submitMissingAlbum}>Download</button>
                    <button class="btn-cancel" on:click={toggleAddAlbumModal}>Cancel</button>
                </div>
            </div>
        </div>
    </div>
{/if}

{#if isEditing}
    <div class="modal-backdrop" use:portal transition:fade={{duration: 200}} on:click|self={toggleEdit}>
        <div class="edit-card" class:max-glass={$isMaxGlassActive} transition:fly={{y: 30, duration: 200}}>
            <div class="edit-header">Edit Artist</div>

            <div class="cover-picker-container" on:click={() => fileInput.click()}>
                <img 
                    src={previewImage || DEFAULT_PLACEHOLDER} 
                    alt="" 
                    class="cover-preview" 
                    on:error={handleImageError}
                />
                <div class="cover-overlay">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span>Change Image</span>
                </div>
            </div>
            
            <input type="file" accept="image/*" bind:this={fileInput} on:change={handleFileChange} hidden />

            <div class="form-group">
                <label>Artist Name</label>
                <input type="text" class="sleek-input" bind:value={editName} />
            </div>

            <details class="nerdy-menu">
                <summary>🛠️ Advanced Path Settings</summary>
                <div class="nerdy-content">
                    <div class="form-group">
                        <label>Raw File Path</label>
                        <input type="text" class="sleek-input" bind:value={editImage} disabled={editImage.startsWith('data:')} />
                        {#if editImage.startsWith('data:')}
                            <small style="color:var(--accent-color);">Base64 override active.</small>
                        {/if}
                    </div>
                </div>
            </details>

            <div style="display: flex; gap: 12px; margin-top: 8px;">
                <button class="btn-save" on:click={saveArtist}>Save</button>
                <button class="btn-cancel" on:click={toggleEdit}>Cancel</button>
            </div>
        </div>
    </div>
{/if}
{/if}

<style>
    /* Content Padding Fixes */
    .album-hero { padding: 32px 24px 72px 24px; }
    
    .artist-wrapper { position: relative; display: inline-block; cursor: pointer; border-radius: 50%; overflow: hidden; width: 232px; height: 232px; }
    .artist-wrapper img { width: 100%; height: 100%; object-fit: cover; }
    .edit-overlay-circle {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.2s ease;
    }
    .artist-wrapper:hover .edit-overlay-circle { opacity: 1; }

    /* --- Action Buttons Styling --- */
    .artist-actions {
        display: flex;
        gap: 12px;
        margin-top: 24px;
    }

    .artist-actions button {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 24px;
        border-radius: 30px;
        font-weight: 700;
        font-size: 14px;
        cursor: pointer;
        border: none;
        transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
    }

    .btn-primary { background: var(--accent-color, white); color: black; }
    .btn-primary:hover { transform: scale(1.04); background: #f0f0f0; }

    .btn-secondary {
        background: rgba(255, 255, 255, 0.05); color: white;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
    }

    .btn-secondary:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.3) !important;
        transform: scale(1.04);
    }

    /* Add Album Card */
    .card.add-album-card {
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px dashed rgba(255, 255, 255, 0.15);
        background: rgba(255, 255, 255, 0.02);
        cursor: pointer;
        transition: all 0.2s ease;
       
    }
    .card.add-album-card:hover {
        border-color: var(--accent-color, #fff);
        background: rgba(255, 255, 255, 0.05);
    }
    .add-album-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        color: rgba(255, 255, 255, 0.4);
        transition: color 0.2s ease;
    }
    .card.add-album-card:hover .add-album-content {
        color: var(--accent-color, #fff);
    }

    /* Add Album Modal (User provided styling) */
    .add-modal-backdrop {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
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

    /* Edit Artist Modals */
    .modal-backdrop {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center; z-index: 10000;
    }

    .edit-card {
        padding: 32px; border-radius: 16px; display: flex; flex-direction: column; gap: 20px;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white;
        width: 400px; max-width: 90vw;
    }

    .edit-card.max-glass {
        border-radius: 24px; background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(32px) saturate(120%); -webkit-backdrop-filter: blur(32px) saturate(120%);
        border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 16px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
    }

    .edit-header { font-size: 20px; font-weight: 800; letter-spacing: 0.5px; text-align: center; }

    .cover-picker-container {
        position: relative; width: 180px; height: 180px; border-radius: 50%; margin: 0 auto;
        overflow: hidden; cursor: pointer; border: 2px dashed rgba(255,255,255,0.2); transition: all 0.2s;
    }
    .cover-picker-container:hover { border-color: var(--accent-color); }
    
    .cover-preview { width: 100%; height: 100%; object-fit: cover; }
    
    .cover-overlay {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); display: flex; flex-direction: column; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.2s; gap: 8px; font-size: 12px; font-weight: bold;
    }
    .cover-picker-container:hover .cover-overlay { opacity: 1; }

    .form-group { display: flex; flex-direction: column; gap: 8px; }
    .form-group label { font-size: 12px; color: rgba(255,255,255,0.6); font-weight: bold; text-transform: uppercase; }
    
    .sleek-input {
        background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); padding: 12px;
        border-radius: 8px; color: white; outline: none; transition: border-color 0.2s; width: 100%; box-sizing: border-box;
    }
    .sleek-input:focus { border-color: var(--accent-color); }

    .nerdy-menu {
        background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px;
        padding: 12px; transition: background 0.2s; cursor: pointer;
    }
    .nerdy-menu summary { font-size: 12px; font-weight: bold; color: rgba(255,255,255,0.5); user-select: none; }
    .nerdy-menu summary:hover { color: white; }
    .nerdy-content { margin-top: 16px; cursor: default; }

    .btn-save { flex: 1; background: var(--accent-color); color: black; border: none; padding: 14px; border-radius: 30px; font-weight: bold; cursor: pointer; transition: transform 0.2s; }
    .btn-save:hover { transform: scale(1.02); }
    .btn-cancel { flex: 1; background: rgba(255,255,255,0.1); color: white; border: none; padding: 14px; border-radius: 30px; font-weight: bold; cursor: pointer; transition: background 0.2s; }
    .btn-cancel:hover { background: rgba(255,255,255,0.2); }

    /* Size Controls Layout */
    .view-controls-wrapper { display: flex; justify-content: space-between; align-items: center; margin: 32px 0 16px 0; padding: 0 24px; }
    .section-title { margin: 0; font-size: 20px; font-weight: 700; color: white; }
    
    .segmented-control { display: flex; background: rgba(255,255,255,0.08); padding: 4px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05); }
    .segmented-control button { background: transparent; border: none; color: white; width: 36px; height: 32px; font-size: 12px; font-weight: 800; cursor: pointer; border-radius: 6px; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
    .segmented-control button.active { background: var(--accent-color); color: black; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }

    .grid-container { padding: 0 24px 32px 24px; }

    /* --- Context Menu Modal --- */
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

    /* --- Card Bottom & 3-Dots Logic --- */
    .card-bottom {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 8px;
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

    .card:hover .card-title { max-width: calc(100% - 32px); }
    .card:hover .more-options-btn { opacity: 1; }
</style>