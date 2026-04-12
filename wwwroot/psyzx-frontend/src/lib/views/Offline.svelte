<script>
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { fly, slide } from 'svelte/transition';
    import {
        allTracks, albumsMap, currentPlaylist, currentIndex,
        isPlaying, isShuffle, shuffleHistory,
        cachedTrackIds, refreshOfflineCache, totalCacheSize
    } from '../../store.js';
    import { formatTime } from '../utils.js';

    // ── State ─────────────────────────────────────────────────────────────────
    let loading       = true;
    let activeDownloads = {};
    let debugLogs     = [];

    // Settings (persisted in localStorage, mirrored to SW)
    const LIMIT_OPTIONS = [
        { label: '50 MB',  bytes: 50  * 1024 * 1024 },
        { label: '100 MB', bytes: 100 * 1024 * 1024 },
        { label: '200 MB', bytes: 200 * 1024 * 1024 },
        { label: '500 MB', bytes: 500 * 1024 * 1024 },
        { label: '1 GB',   bytes: 1024 * 1024 * 1024 },
    ];
    let cacheLimitBytes = parseInt(localStorage.getItem('psyzx_cache_limit') || String(200 * 1024 * 1024));
    let noDownload      = localStorage.getItem('psyzx_no_download') === 'true';

    // ── Derived ───────────────────────────────────────────────────────────────
    $: offlineTracks = $allTracks
        .filter(t => $cachedTrackIds.has(t.id))
        .sort((a, b) => a.title.localeCompare(b.title));

    $: isPlayingPlaylist = $isPlaying
        && $currentPlaylist.length > 0
        && offlineTracks.some(t => t.id === $currentPlaylist[$currentIndex]?.id);

    $: getTrackName = (id) => $allTracks.find(t => t.id == id)?.title || 'Unknown Track';

    const addLog = (msg) => {
        const time = new Date().toLocaleTimeString();
        debugLogs = [`[${time}] ${msg}`, ...debugLogs.slice(0, 4)];
    };

    // ── SW messaging ──────────────────────────────────────────────────────────
    function sendToSW(message) {
        if (navigator.serviceWorker?.controller) {
            navigator.serviceWorker.controller.postMessage(message);
        }
    }

    function applySettings() {
        sendToSW({ type: 'SET_CACHE_LIMIT', bytes: cacheLimitBytes });
        sendToSW({ type: 'SET_NO_DOWNLOAD',  value: noDownload });
    }

    function onLimitChange(e) {
        cacheLimitBytes = parseInt(e.target.value);
        localStorage.setItem('psyzx_cache_limit', String(cacheLimitBytes));
        sendToSW({ type: 'SET_CACHE_LIMIT', bytes: cacheLimitBytes });
    }

    function onNoDownloadToggle() {
        noDownload = !noDownload;
        localStorage.setItem('psyzx_no_download', String(noDownload));
        sendToSW({ type: 'SET_NO_DOWNLOAD', value: noDownload });
    }

    async function deleteTrack(trackId) {
        // Optimistically update UI
        cachedTrackIds.update(s => { const n = new Set(s); n.delete(trackId); return n; });
        sendToSW({ type: 'DELETE_TRACK', trackId: String(trackId) });
    }

    // ── Playback controls ─────────────────────────────────────────────────────
    const togglePlayView = () => {
        if (offlineTracks.length === 0) return;
        const audio = document.querySelector('audio');
        if (isPlayingPlaylist) {
            audio.pause();
        } else {
            if (offlineTracks.some(t => t.id === $currentPlaylist[$currentIndex]?.id)) {
                audio.play();
            } else {
                currentPlaylist.set(offlineTracks);
                if ($isShuffle) {
                    shuffleHistory.set([]);
                    currentIndex.set(Math.floor(Math.random() * offlineTracks.length));
                } else {
                    currentIndex.set(0);
                }
            }
        }
    };

    const toggleShuffleMode = () => {
        isShuffle.set(!$isShuffle);
        currentPlaylist.set(offlineTracks);
        if ($isShuffle) {
            shuffleHistory.set([]);
            currentIndex.set(Math.floor(Math.random() * offlineTracks.length));
        } else {
            currentIndex.set(0);
        }
    };

    const playSpecificTrack = (index) => {
        shuffleHistory.set([]);
        currentPlaylist.set(offlineTracks);
        currentIndex.set(index);
    };

    // ── Swipe-to-queue ────────────────────────────────────────────────────────
    function swipeToQueue(node, track) {
        let startX = 0, currentX = 0;
        const bg = node.previousElementSibling;

        const onStart = e => {
            startX = e.touches[0].clientX;
            node.style.transition = 'none';
            if (bg) bg.style.transition = 'none';
        };
        const onMove = e => {
            currentX = e.touches[0].clientX - startX;
            if (currentX > 0 && currentX < 100) {
                node.style.transform = `translateX(${currentX}px)`;
                if (bg) bg.style.width = `${currentX}px`;
            }
        };
        const onEnd = () => {
            node.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
            node.style.transform = 'translateX(0)';
            if (bg) { bg.style.transition = 'width 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'; bg.style.width = '0px'; }
            if (currentX > 60) {
                const pl   = get(currentPlaylist);
                const cIdx = get(currentIndex);
                if (pl.length === 0) {
                    currentPlaylist.set([track]); currentIndex.set(0);
                } else {
                    const newPl = [...pl];
                    newPl.splice(cIdx + 1, 0, track);
                    currentPlaylist.set(newPl);
                }
            }
            currentX = 0;
        };

        node.addEventListener('touchstart', onStart, { passive: true });
        node.addEventListener('touchmove',  onMove,  { passive: true });
        node.addEventListener('touchend',   onEnd);
        return {
            destroy() {
                node.removeEventListener('touchstart', onStart);
                node.removeEventListener('touchmove',  onMove);
                node.removeEventListener('touchend',   onEnd);
            }
        };
    }

    // ── Mount ─────────────────────────────────────────────────────────────────
    onMount(async () => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', event => {
                const data = event.data;
                if (!data) return;

                if (data.type === 'DEBUG_LOG') addLog(data.msg);

                if (data.type === 'DOWNLOAD_PROGRESS') {
                    activeDownloads[data.trackId] = data.progress;
                    activeDownloads = activeDownloads;
                }

                if (data.type === 'CACHE_UPDATED') {
                    refreshOfflineCache();
                    addLog('✅ Cache updated');
                    setTimeout(() => { activeDownloads = {}; }, 1500);
                }
            });
        }

        await refreshOfflineCache();
        loading = false;

        // Push persisted settings into the SW on every page load
        applySettings();
    });
</script>

{#if loading}
    <div style="padding: 48px; text-align: center;"><div class="spinner" style="margin: 0 auto;"></div></div>
{:else}
    <div class="offline-page-wrapper">
        <div class="fade-bg"></div>

        <div class="album-hero">
            <div class="album-hero-cover" style="background: linear-gradient(135deg, var(--accent-color), #000); border-radius:4px; display:flex; align-items:center; justify-content:center; box-shadow: 0 4px 60px rgba(0,0,0,0.5); flex-shrink: 0;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
                    <path d="M12 15v6"/><polyline points="9 18 12 21 15 18"/>
                </svg>
            </div>
            <div class="album-info">
                <div class="album-type">Local Cache</div>
                <div class="album-title">Available Offline</div>
                <div class="album-meta">
                    <strong>Downloaded Tracks</strong>
                    <span class="dot">•</span>
                    <span>{offlineTracks.length} songs</span>
                    <span class="dot">•</span>
                    <span style="color: var(--accent-color); font-weight: 800;">{$totalCacheSize}</span>
                </div>
            </div>
        </div>

        <div class="action-bar">
            <button class="btn-main-play hoverable" aria-label="Play"
                disabled={offlineTracks.length === 0}
                style={offlineTracks.length === 0 ? 'opacity:0.5' : ''}
                on:click={togglePlayView}>
                {#if isPlayingPlaylist}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                        <rect width="4" height="16" x="6" y="4"/><rect width="4" height="16" x="14" y="4"/>
                    </svg>
                {:else}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                {/if}
            </button>
            <button class="btn-icon-bar hoverable" aria-label="Shuffle"
                class:active={$isShuffle}
                disabled={offlineTracks.length === 0}
                style={offlineTracks.length === 0 ? 'opacity:0.5' : ''}
                on:click={toggleShuffleMode}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/>
                    <path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/>
                    <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>
                </svg>
            </button>
        </div>

        <div class="settings-panel">
            <div class="settings-row">
                <div class="settings-label">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
                        <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
                    </svg>
                    <span>Storage limit</span>
                </div>
                <select class="limit-select" value={cacheLimitBytes} on:change={onLimitChange}>
                    {#each LIMIT_OPTIONS as opt}
                        <option value={opt.bytes}>{opt.label}</option>
                    {/each}
                </select>
            </div>

            <div class="settings-row">
                <div class="settings-label">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="1" y1="1" x2="23" y2="23"/>
                        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 19a10.87 10.87 0 0 1-1.19-.98M10.71 5.05A16 16 0 0 1 22.56 9"/>
                        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.56 2.75c4.37 6 6 9.42 8 17.72m-2-4.72A21.34 21.34 0 0 1 11 18"/>
                    </svg>
                    <span>No auto-download</span>
                    <span class="settings-hint">Stream only, skip background caching</span>
                </div>
                <button
                    class="toggle-btn"
                    class:on={noDownload}
                    on:click={onNoDownloadToggle}
                    aria-pressed={noDownload}
                >
                    <span class="toggle-thumb"></span>
                </button>
            </div>
        </div>

        {#if Object.keys(activeDownloads).length > 0}
            <div class="download-section" transition:slide>
                <div class="sys-title" style="margin-bottom: 12px; font-size: 10px; opacity: 0.6;">ACTIVE DOWNLOADS</div>
                {#each Object.entries(activeDownloads) as [id, progress]}
                    <div class="download-item" in:fly={{ y: 10 }}>
                        <div class="download-info">
                            <span class="dl-name">{getTrackName(id)}</span>
                            <span class="dl-perc">{progress}%</span>
                        </div>
                        <div class="progress-container">
                            <div class="progress-bar" style="width: {progress}%"></div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}

        {#if offlineTracks.length > 0}
            <div class="list-container active-view" id="tracks-container">
                <div class="list-header">
                    <div style="text-align:center;">#</div>
                    <div>Title</div>
                    <div style="text-align:right;">Time</div>
                </div>

                {#each offlineTracks as track, index}
                    {@const album = $albumsMap.get(track.albumId)}
                    <div class="list-item"
                        class:active={$currentPlaylist.length > 0 && $currentPlaylist[$currentIndex]?.id === track.id}>

                        <div class="swipe-bg">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5">
                                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                            </svg>
                        </div>

                        <div class="list-item-content"
                            role="button"
                            tabindex="0"
                            use:swipeToQueue={track}
                            on:click={() => playSpecificTrack(index)}
                            on:keydown={e => e.key === 'Enter' && playSpecificTrack(index)}>

                            <div class="list-item-num">{index + 1}</div>
                            <div style="min-width: 0; flex: 1;">
                                <div class="list-item-title">{track.title}</div>
                                <div class="list-item-artist">
                                    {album ? album.artistName : 'Unknown'} • {album ? album.title : 'Unknown'}
                                </div>
                            </div>
                            <div class="list-item-time">{formatTime(track.durationSeconds || 0)}</div>

                            <button
                                class="delete-btn"
                                aria-label="Remove from cache"
                                on:click|stopPropagation={() => deleteTrack(track.id)}
                                title="Remove from offline cache"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                    <path d="M10 11v6M14 11v6"/>
                                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        {:else}
            <div style="padding: 48px; text-align: center; color: var(--text-secondary);">
                No tracks cached yet. Play tracks while online to make them available offline.
            </div>
        {/if}
    </div>
{/if}

<style>
    /* ── Root Fixes to Prevent Bounds Issues ── */
    .offline-page-wrapper {
        width: 100%;
        max-width: 100vw;
        overflow-x: hidden;
        box-sizing: border-box;
    }

    .offline-page-wrapper * {
        box-sizing: border-box;
    }

    /* ── Structural Layout Classes ── */
    .album-hero {
        display: flex;
        align-items: flex-end;
        gap: 24px;
        padding: 24px 16px 16px 16px;
    }
    
    .album-hero-cover {
        width: 232px;
        height: 232px;
    }

    .album-hero-cover svg {
        width: 64px;
        height: 64px;
    }

    .album-info {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        min-width: 0;
    }

    .album-type {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: rgba(255, 255, 255, 0.6);
    }

    .album-title {
        font-size: 32px;
        font-weight: 800;
        color: white;
        line-height: 1.1;
        white-space: normal;
        word-break: break-word;
    }

    .album-meta {
        font-size: 13px;
        color: rgba(255, 255, 255, 0.6);
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }
    .album-meta .dot { font-size: 18px; line-height: 0; }

    .action-bar {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 0 16px 24px 16px;
    }

    .btn-main-play {
        width: 56px; height: 56px; border-radius: 50%;
        background: white; color: black; border: none;
        display: flex; justify-content: center; align-items: center;
    }

    .btn-main-play svg {
        width: 28px;
        height: 28px;
    }
    
    .btn-icon-bar {
        background: transparent; color: rgba(255,255,255,0.7); border: none;
        padding: 8px;
    }

    .btn-icon-bar svg {
        width: 32px;
        height: 32px;
    }

    .btn-icon-bar.active { color: var(--accent-color); }

    .hoverable { transition: transform 0.2s, background 0.2s, color 0.2s; cursor: pointer; }
    .btn-main-play.hoverable:hover { transform: scale(1.05); background: var(--accent-color); color: black; }
    .btn-icon-bar.hoverable:hover  { color: white; transform: scale(1.1); }

    /* ── Settings panel ─────────────────────────────────────────────────────── */
    .settings-panel {
        margin: 4px 16px 20px 16px;
        padding: 14px 16px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        width: auto;
    }

    .settings-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }

    .settings-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.85);
        flex: 1;
        min-width: 0;
    }

    .settings-hint {
        font-size: 11px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.35);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .limit-select {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: white;
        padding: 5px 10px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        outline: none;
        flex-shrink: 0;
    }

    .limit-select:hover { background: rgba(255, 255, 255, 0.14); }

    /* ── Toggle switch ─────────────────────────────────────────────────────── */
    .toggle-btn {
        position: relative;
        width: 44px;
        height: 26px;
        border-radius: 13px;
        border: none;
        cursor: pointer;
        background: rgba(255, 255, 255, 0.15);
        transition: background 0.25s ease;
        flex-shrink: 0;
        padding: 0;
    }

    .toggle-btn.on { background: var(--accent-color, #b534d1); }

    .toggle-thumb {
        position: absolute;
        top: 3px;
        left: 3px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        display: block;
    }

    .toggle-btn.on .toggle-thumb { transform: translateX(18px); }

    /* ── Downloads section ──────────────────────────────────────────────────── */
    .download-section {
        margin: 0 16px 24px 16px;
        padding: 16px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        backdrop-filter: blur(10px);
        width: auto;
    }

    .download-item { margin-bottom: 12px; }
    .download-item:last-child { margin-bottom: 0; }

    .download-info {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 13px;
        font-weight: 600;
    }

    .dl-name { color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dl-perc { color: var(--accent-color); }

    .progress-container {
        width: 100%;
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        overflow: hidden;
    }

    .progress-bar {
        height: 100%;
        background: var(--accent-color);
        box-shadow: 0 0 10px var(--accent-color);
        transition: width 0.3s ease;
    }
    
    /* ── Track list baseline ── */
    .list-container {
        padding: 0 16px 40px 16px;
        width: 100%;
    }

    .list-header {
        display: flex; gap: 12px; padding: 0 16px 8px 16px;
        font-size: 12px; color: rgba(255,255,255,0.5); border-bottom: 1px solid rgba(255,255,255,0.1);
        margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;
    }

    .list-header div:nth-child(1) { width: 30px; }
    .list-header div:nth-child(2) { flex: 1; }
    .list-header div:nth-child(3) { width: 50px; }

    .list-item {
        position: relative;
        overflow: hidden;
    }

    .list-item-num { width: 30px; text-align: center; color: rgba(255,255,255,0.5); font-size: 14px; }
    .list-item-title { font-size: 16px; color: white; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .list-item-artist { font-size: 13px; color: rgba(255,255,255,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
    .list-item-time { width: 50px; text-align: right; color: rgba(255,255,255,0.5); font-size: 13px; }

    .list-item.active .list-item-title { color: var(--accent-color); font-weight: 700; }
    .list-item.active .list-item-num { color: var(--accent-color); font-weight: 700; }
    
    .swipe-bg {
        position: absolute; top: 0; bottom: 0; left: 0; width: 0;
        background: var(--accent-color); z-index: 1; display: flex; align-items: center;
        overflow: hidden; border-radius: 8px;
    }
    .swipe-bg svg { margin-left: 20px; flex-shrink: 0; }

    /* ── Per-track delete button ────────────────────────────────────────────── */
    .delete-btn {
        opacity: 0;
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.4);
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.15s, color 0.15s, background 0.15s;
        flex-shrink: 0;
    }

    .list-item-content:hover .delete-btn,
    .list-item.active .delete-btn {
        opacity: 1;
    }

    @media (hover: none) {
        .delete-btn { opacity: 0.5; }
    }

    .delete-btn:hover {
        opacity: 1 !important;
        color: #ff4d4d;
        background: rgba(255, 77, 77, 0.12);
    }

    .delete-btn:active {
        transform: scale(0.88);
        color: #ff1a1a;
    }

    .list-item-content {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        cursor: pointer;
        position: relative;
        z-index: 2;
        background: transparent;
        transition: background 0.15s;
        border-radius: 8px;
    }

    .list-item-content:hover { background: rgba(255,255,255,0.04); }

    /* ── Mobile Overrides ─────────────────────────────────────────────────── */
    @media (max-width: 768px) {
        .album-hero { 
            flex-direction: row !important; 
            align-items: center !important; 
            gap: 16px !important; 
            text-align: left !important; 
            padding: 16px !important;
        } 
        
        .album-hero-cover {
            width: 120px !important;
            height: 120px !important;
        }

        .album-hero-cover svg {
            width: 40px !important;
            height: 40px !important;
        }

        .album-info { 
            align-items: flex-start !important; 
            text-align: left !important; 
        } 
        
        .album-title { font-size: 22px !important; }

        .action-bar { 
            justify-content: flex-start !important; 
            gap: 16px !important; 
            padding: 0 16px 16px 16px !important;
        } 

        .btn-main-play {
            width: 44px !important;
            height: 44px !important;
        }

        .btn-main-play svg {
            width: 20px !important;
            height: 20px !important;
        }

        .btn-icon-bar {
            padding: 4px !important;
        }

        .btn-icon-bar svg {
            width: 24px !important;
            height: 24px !important;
        }

        .settings-panel { margin: 0 16px 16px 16px !important; }
        .settings-label { font-size: 12px !important; }
        .settings-hint { display: none !important; }

        .download-section { margin: 0 16px 16px 16px !important; }
        .list-container { padding: 0 16px 40px 16px !important; }
        
        .list-item-content { padding: 8px 4px !important; gap: 8px !important; }
        .list-item-num { font-size: 13px !important; width: 24px !important; }
        .list-item-title { padding-right: 8px !important; font-size: 14px !important; }
        .list-item-artist { font-size: 12px !important; }
        .list-item-time { font-size: 11px !important; width: 40px !important; }
        
        .list-header div:nth-child(1) { width: 24px !important; }
        .list-header div:nth-child(3) { width: 40px !important; }
    }
</style>