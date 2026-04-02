<script>
    import { fade, fly } from 'svelte/transition';
    import { artistsMap, albumsMap, appSessionVersion } from '../../store.js';
    import { api } from '../api.js';

    export let artistId;

    $: artist = $artistsMap.get(parseInt(artistId));
    $: artistAlbums = artist ? Array.from(artist.albums).map(id => $albumsMap.get(id)) : [];
    
    let isEditing = false;
    let editName = '';
    let editImage = '';

    const toggleEdit = () => {
        if (!isEditing) {
            editName = artist.name;
            editImage = artist.imagePath || '';
        }
        isEditing = !isEditing;
    };

    const saveArtist = async () => {
        if (!editName.trim()) return;
        const success = await api.updateArtist(artist.id, editName, editImage);
        if (success) {
            artistsMap.update(map => {
                const a = map.get(parseInt(artistId));
                if (a) { a.name = editName; a.imagePath = editImage; }
                return map;
            });
            appSessionVersion.set(Date.now()); 
            isEditing = false;
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
        <div class="edit-overlay">
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
    <div class="modal-backdrop" transition:fade={{duration: 200}} on:click|self={toggleEdit}>
        <div class="modal" transition:fly={{y: 30, duration: 200}}>
            <h3 style="margin-top: 0; color: white;">Edit Artist</h3>
            <input type="text" bind:value={editName} placeholder="Nome Artista">
            <input type="text" bind:value={editImage} placeholder="URL Immagine (opzionale)">
            <div class="modal-actions">
                <button class="btn-save" on:click={saveArtist}>Salva Modifiche</button>
                <button class="btn-cancel" on:click={toggleEdit}>Annulla</button>
            </div>
        </div>
    </div>
{/if}
{/if}

<style>
    .artist-wrapper { position: relative; display: inline-block; cursor: pointer; border-radius: 50%; overflow: hidden; width: 232px; height: 232px; }
    .artist-wrapper img { width: 100%; height: 100%; object-fit: cover; }
    .edit-overlay {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.2s ease;
    }
    .artist-wrapper:hover .edit-overlay { opacity: 1; }

    /* Stili Modal */
    .modal-backdrop {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center; z-index: 10000;
    }
    .modal {
        background: #181818; padding: 32px; border-radius: 12px; width: 400px; max-width: 90vw;
        border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    }
    .modal input {
        width: 100%; padding: 12px; background: rgba(0,0,0,0.5); color: white;
        border: 1px solid #333; border-radius: 6px; margin-bottom: 16px; box-sizing: border-box;
        font-family: inherit; font-size: 14px; outline: none;
    }
    .modal input:focus { border-color: var(--accent-color); }
    .modal-actions { display: flex; gap: 12px; margin-top: 8px; }
    .btn-save {
        flex: 1; padding: 12px; background: var(--accent-color); color: black;
        border: none; border-radius: 6px; font-weight: bold; cursor: pointer;
    }
    .btn-cancel {
        flex: 1; padding: 12px; background: rgba(255,255,255,0.1); color: white;
        border: none; border-radius: 6px; cursor: pointer;
    }
</style>