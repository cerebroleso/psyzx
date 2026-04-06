<script>
    import { albumsMap, appSessionVersion } from '../store.js';

    const DEFAULT_PLACEHOLDER = '...'; // your base64

    const handleImageError = (ev) => {
        // Prevent infinite loop if placeholder fails
        if (ev.target.src !== DEFAULT_PLACEHOLDER) {
            ev.target.src = DEFAULT_PLACEHOLDER;
        }
    };

    // Sort by plays, but also filter out any albums that might be missing titles
    $: topAlbums = Array.from($albumsMap.values())
        .filter(a => a.title) 
        .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
        .slice(0, 8);

    const goAlbum = (id) => {
        window.location.hash = `#album/${id}`;
    };
</script>

<div class="right-header">Top Albums</div>
<div id="top-albums-container">
    {#each topAlbums as album (album.id)}
        <div class="top-album-item" role="button" tabindex="0" on:click={() => goAlbum(album.id)}>
            <img 
                src={album.coverPath 
                    ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&v=${$appSessionVersion}` 
                    : DEFAULT_PLACEHOLDER} 
                alt={album.title}
                on:error={handleImageError}
            >
            <div>
                <div class="title">{album.title}</div>
                <div class="plays">{album.playCount || 0} plays</div>
            </div>
        </div>
    {/each}
</div>