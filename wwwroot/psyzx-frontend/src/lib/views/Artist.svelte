<script>
    import { fade, fly } from 'svelte/transition';
    import { artistsMap, albumsMap, appSessionVersion, isMaxGlassActive } from '../../store.js';
    import { api } from '../api.js';

    export let artistId;

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

    const toggleEdit = () => {
        if (!isEditing) {
            editName = artist.name;
            editImage = artist.imagePath || '';
            previewImage = artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath)}&v=${$appSessionVersion}` : '';
        }
        isEditing = !isEditing;
    };

    let selectedFile = null; // Aggiungiamo questa variabile per il file binario

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        selectedFile = file; // Salviamo il file "puro" per l'invio
        
        // La preview la teniamo così l'utente vede cosa ha scelto
        const reader = new FileReader();
        reader.onload = (event) => {
            previewImage = event.target.result; 
        };
        reader.readAsDataURL(file);
    };

    const saveArtist = async () => {
        if (!editName.trim()) return;

        // Prepariamo il FormData come vuole il nuovo backend [FromForm]
        const formData = new FormData();
        formData.append('name', editName);
        
        // Aggiungiamo il file solo se l'utente ne ha scelto uno nuovo
        if (selectedFile) {
            formData.append('imageFile', selectedFile);
        }

        // Chiamiamo l'API passando il FormData
        const success = await api.updateArtist(artist.id, formData);
        
        if (success) {
            artistsMap.update(map => {
                const a = map.get(parseInt(artistId));
                if (a) { 
                    a.name = editName;
                    // Forziamo il refresh dell'immagine se è cambiata
                    if (selectedFile) window.location.reload();; 
                }
                return map;
            });
            appSessionVersion.set(Date.now()); 
            isEditing = false;
            selectedFile = null; // Puliamo per la prossima volta
        } else {
            alert("Errore durante il salvataggio.");
        }
    };

    const goAlbum = (id) => { window.location.hash = `#album/${id}`; };
</script>

{#if artist}
<div class="fade-bg"></div>
<div class="album-hero">
    <div class="cover-wrapper artist-wrapper" role="button" tabindex="0" on:click={toggleEdit} on:keydown={(e) => e.key === 'Enter' && toggleEdit()}>
        <img src={artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath)}&v=${$appSessionVersion}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='} alt="Artist">
        <div class="edit-overlay-circle">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
        </div>
    </div>
    
    <div class="album-info">
        <div class="album-type">Artist</div>
        <div class="album-title">{artist.name}</div>
        <div class="album-meta"><span>{artist.albums.size} albums</span></div>
    </div>
</div>

<div class="grid-container">
    {#each artistAlbums as album}
        <div class="card" role="button" tabindex="0" on:click={() => goAlbum(album.id)} on:keydown={(e) => e.key === 'Enter' && goAlbum(album.id)}>
            <img src={album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&v=${$appSessionVersion}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='} alt="Album">
            <div class="card-title">{album.title}</div>
        </div>
    {/each}
</div>

{#if isEditing}
    <div class="modal-backdrop" use:portal transition:fade={{duration: 200}} on:click|self={toggleEdit}>
        <div class="edit-card" class:max-glass={$isMaxGlassActive} transition:fly={{y: 30, duration: 200}}>
            <div class="edit-header">Edit Artist</div>

            <div class="cover-picker-container" on:click={() => fileInput.click()}>
                <img src={previewImage || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='} alt="Artist Preview" class="cover-preview" />
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
    .artist-wrapper { position: relative; display: inline-block; cursor: pointer; border-radius: 50%; overflow: hidden; width: 232px; height: 232px; }
    .artist-wrapper img { width: 100%; height: 100%; object-fit: cover; }
    .edit-overlay-circle {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.2s ease;
    }
    .artist-wrapper:hover .edit-overlay-circle { opacity: 1; }

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
</style>