<script>
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { allTracks, albumsMap, currentPlaylist, currentIndex, isPlaying, isShuffle, shuffleHistory } from '../../store.js';
    import { formatTime } from '../utils.js';

    let offlineTracks = [];
    let loading = true;

    $: isPlayingPlaylist = $isPlaying && $currentPlaylist.length > 0 && offlineTracks.some(t => t.id === $currentPlaylist[$currentIndex]?.id);

    onMount(async () => {
        try {
            if (!('caches' in window)) { console.warn("Cache API non supportata"); loading = false; return; }
            const cachesList = await caches.keys();
            const cachedIds = new Set();
            for (let cName of cachesList) {
                try {
                    const cache = await caches.open(cName);
                    const reqs = await cache.keys();
                    for (let req of reqs) {
                        // FIX: Splitta l'URL fisicamente e prende l'ultimo parametro numerico
                        const parts = req.url.split('?')[0].split('/');
                        const possibleId = parseInt(parts[parts.length - 1], 10);
                        if (!isNaN(possibleId)) {
                            cachedIds.add(possibleId);
                        }
                    }
                } catch(e) {}
            }
            // Mappa l'ID della traccia con gli ID salvati in cache
            offlineTracks = $allTracks.filter(t => cachedIds.has(t.id)).sort((a, b) => a.title.localeCompare(b.title));
        } catch (e) { console.warn("Errore lettura cache", e); }
        loading = false;
    });

    const togglePlayView = () => {
        if (offlineTracks.length === 0) return;
        if (isPlayingPlaylist) { document.querySelector('audio').pause(); } 
        else {
            if (offlineTracks.some(t => t.id === $currentPlaylist[$currentIndex]?.id)) { document.querySelector('audio').play(); } 
            else {
                currentPlaylist.set(offlineTracks);
                if ($isShuffle) { shuffleHistory.set([]); currentIndex.set(Math.floor(Math.random() * offlineTracks.length)); } 
                else { currentIndex.set(0); }
            }
        }
    };

    const toggleShuffleMode = () => {
        isShuffle.set(!$isShuffle);
        currentPlaylist.set(offlineTracks);
        if ($isShuffle) { shuffleHistory.set([]); currentIndex.set(Math.floor(Math.random() * offlineTracks.length)); } 
        else { currentIndex.set(0); }
    };

    const playSpecificTrack = (index) => { shuffleHistory.set([]); currentPlaylist.set(offlineTracks); currentIndex.set(index); };

    function swipeToQueue(node, track) {
        let startX = 0, currentX = 0, isSwiping = false;
        const bg = node.previousElementSibling; 
        const onStart = e => { startX = e.touches[0].clientX; isSwiping = false; node.style.transition = 'none'; if(bg) bg.style.transition = 'none'; };
        const onMove = e => {
            currentX = e.touches[0].clientX - startX;
            if (Math.abs(currentX) > 10) isSwiping = true;
            if (currentX > 0 && currentX < 100) { node.style.transform = `translateX(${currentX}px)`; if(bg) bg.style.width = `${currentX}px`; }
        };
        const onEnd = () => {
            node.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'; node.style.transform = 'translateX(0)';
            if(bg) { bg.style.transition = 'width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'; bg.style.width = '0px'; }
            if (currentX > 60) {
                const pl = get(currentPlaylist);
                if (pl.length === 0) { currentPlaylist.set([track]); currentIndex.set(0); } 
                else { const cIdx = get(currentIndex); const newPl = [...pl]; newPl.splice(cIdx + 1, 0, track); currentPlaylist.set(newPl); }
            }
            setTimeout(() => { isSwiping = false; currentX = 0; }, 50);
        };
        node.addEventListener('touchstart', onStart, {passive: true}); node.addEventListener('touchmove', onMove, {passive: true}); node.addEventListener('touchend', onEnd);
        return { destroy() { node.removeEventListener('touchstart', onStart); node.removeEventListener('touchmove', onMove); node.removeEventListener('touchend', onEnd); } };
    }
</script>

{#if loading}
    <div style="padding: 48px; text-align: center;"><div class="spinner" style="margin: 0 auto;"></div></div>
{:else}
    <div class="fade-bg"></div>
    <div class="album-hero">
        <div style="width:232px; height:232px; background: linear-gradient(135deg, var(--accent-color), #000); border-radius:4px; display:flex; align-items:center; justify-content:center; box-shadow: 0 4px 60px rgba(0,0,0,0.5);">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path><path d="M12 15v6"></path><polyline points="9 18 12 21 15 18"></polyline>
            </svg>
        </div>
        <div class="album-info">
            <div class="album-type">Local Cache</div>
            <div class="album-title">Available Offline</div>
            <div class="album-meta"><strong>Downloaded Tracks</strong><span class="dot">•</span><span>{offlineTracks.length} songs</span></div>
        </div>
    </div>

    <div class="action-bar">
        <button class="btn-main-play hoverable" aria-label="Play" disabled={offlineTracks.length === 0} on:click={togglePlayView} style={offlineTracks.length === 0 ? 'opacity:0.5' : ''}>
            {#if isPlayingPlaylist}
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><rect width="4" height="16" x="6" y="4"></rect><rect width="4" height="16" x="14" y="4"></rect></svg>
            {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            {/if}
        </button>
        <button class="btn-icon-bar hoverable" aria-label="Shuffle" class:active={$isShuffle} disabled={offlineTracks.length === 0} on:click={toggleShuffleMode} style={offlineTracks.length === 0 ? 'opacity:0.5' : ''}>
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg>
        </button>
    </div>

    {#if offlineTracks.length > 0}
        <div class="list-container active-view" id="tracks-container">
            <div class="list-header">
                <div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;">Time</div>
            </div>
            {#each offlineTracks as track, index}
                {@const album = $albumsMap.get(track.albumId)}
                <div class="list-item" class:active={$currentPlaylist.length > 0 && $currentPlaylist[$currentIndex]?.id === track.id}>
                    <div class="swipe-bg"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>
                    <div class="list-item-content" role="button" tabindex="0" use:swipeToQueue={track} on:click={() => playSpecificTrack(index)} on:keydown={(e) => e.key === 'Enter' && playSpecificTrack(index)}>
                        <div class="list-item-num">{index + 1}</div>
                        <div style="min-width: 0;">
                            <div class="list-item-title">{track.title}</div>
                            <div class="list-item-artist">{album ? album.artistName : 'Unknown'} • {album ? album.title : 'Unknown'}</div>
                        </div>
                        <div class="list-item-time">{formatTime(track.durationSeconds || 0)}</div>
                    </div>
                </div>
            {/each}
        </div>
    {:else}
        <div style="padding: 48px; text-align: center; color: var(--text-secondary);">Nessuna traccia in cache trovata. Ascolta le canzoni per scaricarle in background.</div>
    {/if}
{/if}

<style>
    .hoverable { transition: transform 0.2s, background 0.2s, color 0.2s; cursor: pointer; }
    .btn-main-play.hoverable:hover { transform: scale(1.05); background: var(--accent-color); color: black; }
    .btn-icon-bar.hoverable:hover { color: white; transform: scale(1.1); }
</style>