<script>
    import { artistsMap, appSessionVersion, viewSize } from '../../store.js';
    
    $: artistsArray = Array.from($artistsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    const goArtist = (id) => {
        window.location.hash = `#artist/${id}`;
    };

    const updateViewSize = (size) => {
        viewSize.set(size);
        localStorage.setItem('psyzx_view_size', size);
    };
</script>

<div class="view-controls-wrapper">
    <h2 class="section-title">Library</h2>
    <div class="segmented-control">
        <button class:active={$viewSize === 'large'} on:click={() => updateViewSize('large')}>L</button>
        <button class:active={$viewSize === 'medium'} on:click={() => updateViewSize('medium')}>M</button>
        <button class:active={$viewSize === 'small'} on:click={() => updateViewSize('small')}>S</button>
        <button class:active={$viewSize === 'lines'} on:click={() => updateViewSize('lines')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
    </div>
</div>

<div class="grid-container {$viewSize || 'medium'}">
    {#each artistsArray as artist}
        <div class="card" role="button" tabindex="0" on:click={() => goArtist(artist.id)} on:keydown={(e) => e.key === 'Enter' && goArtist(artist.id)}>
            <img src={artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath)}&v=${$appSessionVersion}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='} alt="Artist">
            <div class="card-title">{artist.name}</div>
        </div>
    {/each}
</div>

<style>
    /* Size Controls */
    .view-controls-wrapper {
        display: flex; justify-content: space-between; align-items: center;
        margin: 24px 0 16px 0; padding: 0 8px;
    }
    .section-title { margin: 0; font-size: 20px; font-weight: 700; color: white; }
    
    .segmented-control {
        display: flex; background: rgba(255,255,255,0.08); padding: 4px; border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.05);
    }
    .segmented-control button {
        background: transparent; border: none; color: white; width: 36px; height: 32px;
        font-size: 12px; font-weight: 800; cursor: pointer; border-radius: 6px;
        transition: all 0.2s; display: flex; align-items: center; justify-content: center;
    }
    .segmented-control button.active { background: var(--accent-color); color: black; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
</style>