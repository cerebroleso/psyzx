<script>
    import { albumsMap } from '../store.js';

    // Ricalcola i top albums automaticamente quando la mappa cambia
    $: topAlbums = Array.from($albumsMap.values())
        .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
        .slice(0, 8);

    const goAlbum = (id) => {
        window.location.hash = `#album/${id}`;
    };
</script>

<div class="right-header">Top Albums</div>
<div id="top-albums-container">
    {#each topAlbums as album}
        <div class="top-album-item" role="button" tabindex="0" on:click={() => goAlbum(album.id)} on:keydown={(e) => e.key === 'Enter' && goAlbum(album.id)}>
            <img src={album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='} alt="Cover">
            <div>
                <div class="title">{album.title}</div>
                <div class="plays">{album.playCount || 0} plays</div>
            </div>
        </div>
    {/each}
</div>