<script>
    import { get } from 'svelte/store';
    import { fade } from 'svelte/transition';
    import { albumsMap, currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat, shuffleHistory, accentColor, isGlobalColorActive, isMaxGlassActive } from '../../store.js';
    import { formatTime } from '../utils.js';

    export let albumId; 

    $: album = $albumsMap.get(parseInt(albumId));
    $: tracks = album ? [...album.tracks].sort((a, b) => {
        const discA = a.discNumber || 1; const discB = b.discNumber || 1;
        if (discA !== discB) return discA - discB;
        if (a.trackNumber !== b.trackNumber && a.trackNumber > 0) return a.trackNumber - b.trackNumber;
        return a.title.localeCompare(b.title);
    }) : [];

    $: totalSeconds = tracks.reduce((sum, t) => sum + t.durationSeconds, 0);
    $: hrs = Math.floor(totalSeconds / 3600);
    $: mins = Math.floor((totalSeconds % 3600) / 60);
    $: timeString = hrs > 0 ? `${hrs} hr ${mins} min` : `${mins} min`;
    
    $: totalAlbumPlays = tracks.reduce((sum, t) => sum + (t.playCount || 0), 0);
    $: maxPlay = Math.max(...tracks.map(t => t.playCount || 0));
    
    $: coverUrl = album && album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : '';
    $: avgBitrate = tracks.length > 0 ? Math.round(tracks.reduce((s, t) => s + (t.bitrate||0), 0) / tracks.length) : 0;
    
    $: isPlayingAlbum = $isPlaying && $currentPlaylist.some(t => tracks.find(pt => pt.id === t.id));

    let albumColor = '#b534d1';
    
    const extractAlbumColor = async (url) => {
        if (typeof document === 'undefined') return;
        if (!url) { albumColor = '#b534d1'; return; }
        try {
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) throw new Error('Auth err');
            
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                try {
                    const cvs = document.createElement('canvas'); 
                    cvs.width = 64; 
                    cvs.height = 64;
                    const ctx = cvs.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, 64, 64);
                    const [r, g, b] = ctx.getImageData(32, 32, 1, 1).data;
                    const boost = Math.max(r, g, b) < 40 ? 50 : 0;
                    albumColor = `rgb(${r+boost},${g+boost},${b+boost})`;
                } catch(e) { 
                    albumColor = '#b534d1'; 
                }
                URL.revokeObjectURL(objUrl);
            };
            img.onerror = () => { albumColor = '#b534d1'; };
            img.src = objUrl;
        } catch (e) {
            albumColor = '#b534d1';
        }
    };
    
    $: extractAlbumColor(coverUrl);

    let viewMode = 'list'; 
    let mounted = false;
    import { onMount } from 'svelte';
    onMount(() => { setTimeout(() => mounted = true, 50); });

    const togglePlayAlbum = () => {
        if (isPlayingAlbum) {
            document.querySelector('audio').pause();
        } else {
            if ($currentPlaylist.some(t => tracks.find(pt => pt.id === t.id))) {
                document.querySelector('audio').play(); 
            } else {
                currentPlaylist.set(tracks);
                if ($isShuffle) { shuffleHistory.set([]); currentIndex.set(Math.floor(Math.random() * tracks.length)); } 
                else { currentIndex.set(0); }
            }
        }
    };

    const toggleShuffleMode = () => {
        isShuffle.set(!$isShuffle);
        currentPlaylist.set(tracks);
        if ($isShuffle) { shuffleHistory.set([]); currentIndex.set(Math.floor(Math.random() * tracks.length)); } 
        else { currentIndex.set(0); }
    };

    const playSpecificTrack = (index) => { shuffleHistory.set([]); currentPlaylist.set(tracks); currentIndex.set(index); };

    function swipeToQueue(node, track) {
        let startX = 0, currentX = 0, isSwiping = false, hasVibrated = false;
        const bg = node.previousElementSibling; 
        const onStart = e => { startX = e.touches[0].clientX; isSwiping = false; hasVibrated = false; node.style.transition = 'none'; bg.style.transition = 'none'; };
        const onMove = e => {
            currentX = e.touches[0].clientX - startX;
            if (Math.abs(currentX) > 10) isSwiping = true;
            if (currentX > 0 && currentX < 100) {
                node.style.transform = `translateX(${currentX}px)`; bg.style.width = `${currentX}px`;
                const icon = bg.querySelector('svg');
                if (currentX > 60) {
                    bg.style.backgroundColor = 'var(--accent-color)';
                    if (icon) icon.style.transform = 'translate(-50%, -50%) scale(1.2)';
                    if (!hasVibrated) { if (navigator.vibrate) navigator.vibrate(50); hasVibrated = true; }
                } else {
                    bg.style.backgroundColor = 'rgba(181, 52, 209, 0.5)';
                    if (icon) icon.style.transform = 'translate(-50%, -50%) scale(1)';
                    hasVibrated = false;
                }
            }
        };
        const onEnd = () => {
            node.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'; node.style.transform = 'translateX(0)';
            bg.style.transition = 'width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.3s'; bg.style.width = '0px';
            const icon = bg.querySelector('svg'); if (icon) icon.style.transform = 'translate(-50%, -50%) scale(1)';
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

{#if album}
<div class="view-wrapper" class:max-glass={$isMaxGlassActive}>
    {#if !$isGlobalColorActive}
        <div class="fade-bg-dynamic" style="background-color: {albumColor};"></div>
    {/if}
    
    <div class="album-header-block">
        <div class="album-hero">
            <div class="cover-wrapper">
                <img src={coverUrl || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='} alt="Album Cover" style="width: 232px; height: 232px; object-fit: cover;">
            </div>
            <div class="album-info">
                <div class="album-type">Album</div>
                <div class="album-title">{album.title}</div>
                <div class="album-meta">
                    <strong>{album.artistName}</strong><span class="dot">•</span>
                    <span>{album.releaseYear > 0 ? album.releaseYear : ''}</span><span class="dot">•</span>
                    <span>{tracks.length} songs</span><span class="dot">•</span>
                    <span class="duration-highlight">{timeString}</span>
                    
                    {#if avgBitrate > 0}
                    <div class="kbps-badge-inline">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent-color)"><rect x="3" y="8" width="4" height="8"/><rect x="10" y="4" width="4" height="16"/><rect x="17" y="10" width="4" height="4"/></svg>
                        <span>{avgBitrate} kbps</span>
                        <span class="ext">AVG</span>
                    </div>
                    {/if}
                </div>
            </div>
        </div>

        <div class="header-separator"></div>

        <div class="action-bar">
            <button class="btn-main-play hoverable" aria-label="Play Album" on:click={togglePlayAlbum}>
                {#if isPlayingAlbum}
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><rect width="4" height="16" x="6" y="4"></rect><rect width="4" height="16" x="14" y="4"></rect></svg>
                {:else}
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                {/if}
            </button>
            <button class="btn-icon-bar hoverable" aria-label="Shuffle" class:active={$isShuffle} on:click={toggleShuffleMode} title="Shuffle">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg>
            </button>
            <button class="btn-icon-bar hoverable" aria-label="Stats View" class:active={viewMode === 'stats'} on:click={() => viewMode = viewMode === 'stats' ? 'list' : 'stats'} title="Toggle Stats Bar">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            </button>
            <button class="btn-icon-bar hoverable" aria-label="PS2 View" class:active={viewMode === 'ps2'} on:click={() => viewMode = viewMode === 'ps2' ? 'list' : 'ps2'} title="PS2 Tower View">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
            </button>
        </div>
    </div>

    {#if viewMode === 'ps2'}
        <div id="ps2-tower-container" class="active-view" in:fade={{duration: 200}}>
            <div class="ps2-scroll-wrapper">
                <div class="ps2-grid">
                    {#each tracks as track, index}
                        {@const ps2Height = maxPlay > 0 ? ((track.playCount || 0) / maxPlay) * 180 + 20 : 20}
                        <div class="ps2-tower-container-3d" style="--tower-h: {ps2Height}px;" role="button" tabindex="0" on:click={() => playSpecificTrack(index)} on:keydown={(e) => e.key === 'Enter' && playSpecificTrack(index)}>
                            <div class="ps2-face ps2-front"></div>
                            <div class="ps2-face ps2-back"></div>
                            <div class="ps2-face ps2-right"></div>
                            <div class="ps2-face ps2-left"></div>
                            <div class="ps2-face ps2-top">{track.trackNumber > 0 ? track.trackNumber : index + 1}</div>
                            <div class="ps2-tooltip">{track.title}<br>{track.playCount || 0} plays</div>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {:else}
        <div class="list-container active-view" class:show-stats={viewMode === 'stats'} id="tracks-container" in:fade={{duration: 200}}>
            <div class="list-header">
                <div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>
            </div>
            
            {#each tracks as track, index}
                {@const pct = totalAlbumPlays > 0 ? ((track.playCount || 0) / totalAlbumPlays) * 100 : 0}
                <div class="list-item" class:active={$currentPlaylist.length > 0 && $currentPlaylist[$currentIndex]?.id === track.id}>
                    <div class="swipe-bg"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>
                    <div class="stat-bar" style="--stat-w: {mounted && viewMode === 'stats' ? pct : 0}%; transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) {index * 0.04}s;"></div>
                    <div class="list-item-content" role="button" tabindex="0" use:swipeToQueue={track} on:click={() => playSpecificTrack(index)} on:keydown={(e) => e.key === 'Enter' && playSpecificTrack(index)}>
                        <div class="list-item-num">{track.trackNumber > 0 ? track.trackNumber : index + 1}</div>
                        <div style="min-width: 0;">
                            <div class="list-item-title">{track.title}</div>
                            <div class="list-item-artist">{album.artistName}</div>
                        </div>
                        <div class="list-item-time">{formatTime(track.durationSeconds)}</div>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
{/if}

<style>
    .view-wrapper { position: relative; min-height: 100%; }
    
    .fade-bg-dynamic {
        position: absolute; top: 0; left: 0; width: 100%; height: 400px;
        -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%);
        mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%);
        opacity: 0.35; z-index: 0; pointer-events: none;
        transition: background-color 0.8s ease-in-out;
    }

    .album-header-block {
        display: flex; flex-direction: column; gap: 0; margin-bottom: 24px;
        background: rgba(255, 255, 255, 0.03);
        backdrop-filter: blur(32px) saturate(150%);
        -webkit-backdrop-filter: blur(32px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 24px;
        padding: 20px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2), inset 1px 1px 0 rgba(255,255,255,0.05);
    }

    .album-hero { display: flex; gap: 24px; align-items: flex-end; margin-bottom: 0; }
    .action-bar { display: flex; align-items: center; gap: 16px; margin-bottom: 0; }
    .header-separator { height: 1px; background: rgba(255,255,255,0.1); margin: 16px 0; width: 100%; }

    .max-glass .album-header-block {
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.1);
        box-shadow: 0 8px 32px rgba(0,0,0,0.2), inset 1px 1px 0 rgba(255,255,255,0.1);
    }

    .max-glass .list-container {
        background: rgba(255, 255, 255, 0.03);
        backdrop-filter: blur(32px) saturate(150%);
        -webkit-backdrop-filter: blur(32px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 24px;
        padding: 16px;
        box-shadow: inset 1px 1px 0 rgba(255,255,255,0.05);
    }

    .max-glass .list-item { border-radius: 12px; background: transparent; border-bottom: 1px solid rgba(255,255,255,0.02); }
    .max-glass .list-item:hover { background: rgba(255, 255, 255, 0.08); }
    
    .duration-highlight { color: var(--accent-color); font-weight: 800; text-shadow: 0 0 8px rgba(181, 52, 209, 0.4); }
    
    .kbps-badge-inline {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(0,0,0,0.4); padding: 4px 8px; border-radius: 6px;
        font-size: 11px; font-family: monospace; font-weight: bold;
        border: 1px solid rgba(255,255,255,0.1); margin-left: 12px; vertical-align: middle;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .kbps-badge-inline .ext { color: var(--accent-color); }

    .hoverable { transition: transform 0.2s, background 0.2s, color 0.2s; cursor: pointer; }
    .btn-main-play.hoverable:hover { transform: scale(1.05); background: var(--accent-color); color: black; }
    .btn-icon-bar.hoverable:hover { color: white; transform: scale(1.1); }

    .ps2-scroll-wrapper { width: 100%; overflow-x: auto; overflow-y: hidden; padding-bottom: 40px; }

    .ps2-grid {
        display: flex; gap: 24px; align-items: flex-end; height: 350px; padding: 40px 24px 0 24px;
        perspective: 1200px; transform-style: preserve-3d; width: max-content;
    }
    
    .ps2-tower-container-3d {
        position: relative; width: 36px; height: var(--tower-h); transform-style: preserve-3d;
        transform: rotateX(-15deg) rotateY(-30deg); transition: transform 0.3s ease; cursor: pointer; flex-shrink: 0;
    }
    
    .ps2-tower-container-3d:hover { transform: rotateX(-15deg) rotateY(-30deg) translateY(-10px); }
    
    .ps2-face { position: absolute; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.2); box-sizing: border-box; }
    
    .ps2-front { width: 100%; height: 100%; bottom: 0; left: 0; background: var(--accent-color); transform: rotateY(0deg) translateZ(18px); }
    .ps2-back { width: 100%; height: 100%; bottom: 0; left: 0; background: rgba(0,0,0,0.8); transform: rotateY(180deg) translateZ(18px); }
    .ps2-right { width: 100%; height: 100%; bottom: 0; left: 0; background: rgba(0,0,0,0.6); transform: rotateY(90deg) translateZ(18px); }
    .ps2-left { width: 100%; height: 100%; bottom: 0; left: 0; background: rgba(0,0,0,0.6); transform: rotateY(-90deg) translateZ(18px); }
    .ps2-top {
        width: 36px; height: 36px; top: 0; left: 0; background: rgba(255,255,255,0.4);
        transform: translateY(-18px) rotateX(90deg); font-size: 11px; font-weight: bold; color: white; text-shadow: 1px 1px 2px black;
    }
    
    .ps2-tooltip {
        position: absolute; bottom: calc(100% + 20px); left: 50%; transform: translateX(-50%) rotateX(15deg) rotateY(30deg);
        background: #000; color: white; padding: 6px 12px; border-radius: 4px; font-size: 12px; white-space: nowrap;
        opacity: 0; pointer-events: none; transition: opacity 0.2s; text-align: center; border: 1px solid var(--accent-color); z-index: 10;
    }
    .ps2-tower-container-3d:hover .ps2-tooltip { opacity: 1; }

    @media (max-width: 768px) {
        .album-hero { flex-direction: column; align-items: center; gap: 16px; text-align: center; }
        .album-info { align-items: center; text-align: center; }
        .action-bar { justify-content: center; flex-wrap: wrap; }
    }
</style>