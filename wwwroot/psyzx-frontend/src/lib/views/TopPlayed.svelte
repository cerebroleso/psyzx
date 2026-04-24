<script>
    import { get } from 'svelte/store';
    import { allTracks, albumsMap, currentPlaylist, currentIndex, isPlaying, isShuffle, shuffleHistory, userQueue } from '../../store.js';
    import { togglePlayGlobal } from '../audio.js';
    import { flip } from 'svelte/animate';
    import { fade, fly } from 'svelte/transition';

    $: topTracks = [...$allTracks].sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, 50);

    // FIX: Seleziona esattamente se il bottone deve mostrare pausa o play in base alla lista esatta.
    $: isPlayingPlaylist = $isPlaying && $currentPlaylist.length === topTracks.length && $currentPlaylist[0]?.id === topTracks[0]?.id;

    const togglePlayView = () => {
        if (isPlayingPlaylist) {
            togglePlayGlobal();
        } else {
            if ($currentPlaylist.length === topTracks.length && $currentPlaylist[0]?.id === topTracks[0]?.id) {
                togglePlayGlobal(); 
            } else {
                currentPlaylist.set(topTracks);
                if ($isShuffle) { shuffleHistory.set([]); currentIndex.set(Math.floor(Math.random() * topTracks.length)); } 
                else { currentIndex.set(0); }
            }
        }
    };

    const toggleShuffleMode = () => {
        isShuffle.set(!$isShuffle);
        currentPlaylist.set(topTracks);
        if ($isShuffle) { shuffleHistory.set([]); currentIndex.set(Math.floor(Math.random() * topTracks.length)); } 
        else { currentIndex.set(0); }
    };

    const playSpecificTrack = (index) => { shuffleHistory.set([]); currentPlaylist.set(topTracks); currentIndex.set(index); };

    function swipeToQueue(node, track) {
        let startX = 0, currentX = 0, isSwiping = false, hasVibrated = false;
        const bg = node.previousElementSibling; 
        const onStart = e => { startX = e.touches[0].clientX; isSwiping = false; hasVibrated = false; node.style.transition = 'none'; if(bg) bg.style.transition = 'none'; };
        const onMove = e => {
            currentX = e.touches[0].clientX - startX;
            if (Math.abs(currentX) > 10) isSwiping = true;
            if (currentX > 0 && currentX < 100) {
                node.style.transform = `translateX(${currentX}px)`; if(bg) bg.style.width = `${currentX}px`;
                const icon = bg ? bg.querySelector('svg') : null;
                if (currentX > 60) {
                    if(bg) bg.style.backgroundColor = 'var(--accent-color)';
                    if (icon) icon.style.transform = 'translate(-50%, -50%) scale(1.2)';
                    if (!hasVibrated) { if (navigator.vibrate) navigator.vibrate(50); hasVibrated = true; }
                } else {
                    if(bg) bg.style.backgroundColor = 'rgba(181, 52, 209, 0.5)';
                    if (icon) icon.style.transform = 'translate(-50%, -50%) scale(1)';
                    hasVibrated = false;
                }
            }
        };
        const onEnd = () => {
            node.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'; node.style.transform = 'translateX(0)';
            if(bg) { bg.style.transition = 'width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'; bg.style.width = '0px'; }
            const icon = bg ? bg.querySelector('svg') : null; if (icon) icon.style.transform = 'translate(-50%, -50%) scale(1)';
            
            if (currentX > 60) {
                currentPlaylist.update(currentList => {
                    if (!currentList || currentList.length === 0) { currentIndex.set(0); return [track]; }
                    const newList = [...currentList]; let cIdx = 0; currentIndex.subscribe(v => cIdx = v)();
                    newList.splice(cIdx + 1, 0, track); return newList;
                });
            }
            setTimeout(() => { isSwiping = false; currentX = 0; }, 50);
        };
        node.addEventListener('touchstart', onStart, {passive: true}); node.addEventListener('touchmove', onMove, {passive: true}); node.addEventListener('touchend', onEnd);
        return { destroy() { node.removeEventListener('touchstart', onStart); node.removeEventListener('touchmove', onMove); node.removeEventListener('touchend', onEnd); } };
    }
</script>

<div class="fade-bg"></div>
<div class="album-hero">
    <img src="/api/Tracks/image?path=most_listened.jpg" alt="Top Played" on:error={(e) => e.currentTarget.setAttribute('src', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=')}>
    <div class="album-info">
        <div class="album-type">Automated Playlist</div>
        <div class="album-title">On Repeat</div>
        <div class="album-meta"><strong>Your absolute favorites</strong><span class="dot">•</span><span>{topTracks.length} songs</span></div>
    </div>
</div>

<div class="action-bar">
    <button class="btn-main-play hoverable" aria-label="Play" on:click={togglePlayView}>
        {#if isPlayingPlaylist}
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><rect width="4" height="16" x="6" y="4"></rect><rect width="4" height="16" x="14" y="4"></rect></svg>
        {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        {/if}
    </button>
    <button class="btn-icon-bar hoverable" aria-label="Shuffle" class:active={$isShuffle} on:click={toggleShuffleMode}>
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg>
    </button>
</div>

<div class="list-container active-view" id="tracks-container">
    <div class="list-header">
        <div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;">Plays</div>
    </div>
    
    {#each topTracks as track, index (track.id)}
        {@const album = $albumsMap.get(track.albumId)}
        <div class="list-item" class:active={$currentPlaylist.length > 0 && $currentPlaylist[$currentIndex]?.id === track.id} animate:flip={{duration: 600}} in:fly={{y: 30, duration: 500, delay: 100}} out:fade={{duration: 300}}>
            <div class="swipe-bg"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>
            <div class="list-item-content" role="button" tabindex="0" use:swipeToQueue={track} on:click={() => playSpecificTrack(index)} on:keydown={(e) => e.key === 'Enter' && playSpecificTrack(index)}>
                <div class="list-item-num">{index + 1}</div>
                <div style="min-width: 0;">
                    <div class="list-item-title">{track.title}</div>
                    <div class="list-item-artist">{album ? album.artistName : 'Unknown'}</div>
                </div>
                <div class="list-item-time">{track.playCount || 0}</div>
            </div>
        </div>
    {/each}
</div>

<style>
    .hoverable { transition: transform 0.2s, background 0.2s, color 0.2s; cursor: pointer; }
    .btn-main-play.hoverable:hover { transform: scale(1.05); background: var(--accent-color); color: black; }
    .btn-icon-bar.hoverable:hover { color: white; transform: scale(1.1); }
</style>