<script>
    import { allTracks, artistsMap, albumsMap } from '../../store.js';

    export let query = '';

    $: q = query.toLowerCase().trim();

    $: resultsTracks = $allTracks.filter(t => 
        t.title?.toLowerCase().includes(q) || 
        t.album?.title?.toLowerCase().includes(q) || 
        t.album?.artist?.name?.toLowerCase().includes(q)
    );

    $: resultsArtists = Array.from($artistsMap.values()).filter(a => 
        a.name?.toLowerCase().includes(q)
    );

    $: resultsAlbums = Array.from($albumsMap.values()).filter(a => 
        a.title?.toLowerCase().includes(q) || 
        a.artistName?.toLowerCase().includes(q)
    );
</script>

<div class="search-view">
    {#if q === ''}
        <div class="empty-state">Type something to search</div>
    {:else}
        {#if resultsArtists.length > 0}
            <h2>Artists</h2>
            <div class="grid-container">
                {#each resultsArtists as artist}
                    <a href="#artist/{artist.id}" class="card artist-card">
                        <img src={artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath.split('?')[0])}` : '/placeholder.png'} alt={artist.name} />
                        <div class="card-info">
                            <div class="title">{artist.name}</div>
                        </div>
                    </a>
                {/each}
            </div>
        {/if}

        {#if resultsAlbums.length > 0}
            <h2>Albums</h2>
            <div class="grid-container">
                {#each resultsAlbums as album}
                    <a href="#album/{album.id}" class="card album-card">
                        <img src={album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath.split('?')[0])}` : '/placeholder.png'} alt={album.title} />
                        <div class="card-info">
                            <div class="title">{album.title}</div>
                            <div class="subtitle">{album.artistName}</div>
                        </div>
                    </a>
                {/each}
            </div>
        {/if}

        {#if resultsTracks.length > 0}
            <h2>Tracks</h2>
            <div class="track-list">
                {#each resultsTracks as track}
                    <div class="track-item">
                        <div class="track-info">
                            <div class="track-title">{track.title}</div>
                            <div class="track-artist">{track.album.artist.name} &bull; {track.album.title}</div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}

        {#if resultsArtists.length === 0 && resultsAlbums.length === 0 && resultsTracks.length === 0}
            <div class="empty-state">No results found for "{query}"</div>
        {/if}
    {/if}
</div>

<style>
    .search-view {
        padding: 24px;
        padding-bottom: 120px;
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
        text-decoration: none;
        color: inherit;
        display: flex;
        flex-direction: column;
        background: rgba(255,255,255,0.02);
        padding: 16px;
        border-radius: 12px;
        transition: background 0.2s ease;
    }

    .card:hover {
        background: rgba(255,255,255,0.08);
    }

    .card img {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        border-radius: 8px;
        margin-bottom: 16px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    }

    .artist-card img {
        border-radius: 50%;
    }

    .title {
        font-weight: 700;
        color: white;
        font-size: 16px;
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .subtitle {
        font-size: 14px;
        color: rgba(255,255,255,0.5);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .track-item {
        display: flex;
        padding: 12px 16px;
        background: rgba(255,255,255,0.03);
        border-radius: 8px;
        transition: background 0.2s ease;
    }

    .track-item:hover {
        background: rgba(255,255,255,0.08);
    }

    .track-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .track-title {
        color: white;
        font-weight: 600;
        font-size: 15px;
    }

    .track-artist {
        font-size: 13px;
        color: rgba(255,255,255,0.5);
    }

    .empty-state {
        color: rgba(255,255,255,0.4);
        text-align: center;
        padding: 64px 24px;
        font-size: 18px;
        font-weight: 600;
    }
</style>