<script>
    import { artistsMap, appSessionVersion } from '../../store.js';
    
    $: artistsArray = Array.from($artistsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    const goArtist = (id) => {
        window.location.hash = `#artist/${id}`;
    };
</script>

<div class="grid-container">
    {#each artistsArray as artist}
        <div class="card" role="button" tabindex="0" on:click={() => goArtist(artist.id)} on:keydown={(e) => e.key === 'Enter' && goArtist(artist.id)}>
            <img src={artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath)}&v=${$appSessionVersion}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='} alt="Artist">
            <div class="card-title">{artist.name}</div>
        </div>
    {/each}
</div>