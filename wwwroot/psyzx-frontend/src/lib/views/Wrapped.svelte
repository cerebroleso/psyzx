<script>
    import { onMount } from 'svelte';
    import { api } from '../api.js';
    import { fade, scale } from 'svelte/transition';

    let duration = 'month';
    let stats = null;
    let loading = true;
    let error = null;

    const fetchStats = async () => {
        loading = true;
        stats = await api.getWrappedStats(duration);
        loading = false;
    };

    onMount(() => {
        fetchStats();
    });

    const formatTime = (seconds) => {
        if (!seconds) return '0m';
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins}m`;
        const hours = Math.floor(mins / 60);
        const remMins = mins % 60;
        return `${hours}h ${remMins}m`;
    };
</script>

<div class="fade-bg"></div>

<div class="wrapped-header">
    <h1 style="color: var(--accent-color); font-weight: 900; letter-spacing: -1.5px; font-size: 48px; margin: 0;">Listening Habits</h1>
    
    <div class="duration-toggles">
        <button class:active={duration === 'week'} on:click={() => { duration = 'week'; fetchStats(); }}>7 Days</button>
        <button class:active={duration === 'month'} on:click={() => { duration = 'month'; fetchStats(); }}>30 Days</button>
        <button class:active={duration === 'year'} on:click={() => { duration = 'year'; fetchStats(); }}>This Year</button>
        <button class:active={duration === 'all'} on:click={() => { duration = 'all'; fetchStats(); }}>All Time</button>
    </div>
</div>

<div class="content-container">
    {#if loading}
        <div class="loading-state">Analyzing behavior...</div>
    {:else if stats && (stats.topTrack || stats.topAlbum || stats.topArtist)}
        <div class="stats-grid">
            
            <div class="stat-card standout" in:scale={{duration: 400, start: 0.95}}>
                <div class="stat-label">Total Time Listened</div>
                <div class="stat-value huge">{formatTime(stats.totalListenTimeSeconds)}</div>
            </div>

            {#if stats.topTrack}
            <div class="stat-card" in:scale={{duration: 400, delay: 100, start: 0.95}}>
                <div class="stat-label">Top Track</div>
                <div class="stat-content">
                    <div class="track-icon-placeholder">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                    </div>
                    <div>
                        <div class="stat-value">{stats.topTrack.title}</div>
                    </div>
                </div>
            </div>
            {/if}

            {#if stats.topAlbum}
            <div class="stat-card" in:scale={{duration: 400, delay: 150, start: 0.95}}>
                <div class="stat-label">Top Album</div>
                <div class="stat-content">
                    <img src="{api.baseUrl}/Tracks/image?path={encodeURIComponent(stats.topAlbum.coverPath || '')}" alt="Album Cover" on:error={(e) => e.currentTarget.style.display = 'none'} />
                    <div>
                        <div class="stat-value">{stats.topAlbum.title}</div>
                    </div>
                </div>
            </div>
            {/if}

            {#if stats.topArtist}
            <div class="stat-card" in:scale={{duration: 400, delay: 200, start: 0.95}}>
                <div class="stat-label">Top Artist</div>
                <div class="stat-content">
                    <img src="{api.baseUrl}/Tracks/image?path={encodeURIComponent(stats.topArtist.imagePath || '')}" class="artist-img" alt="Artist" on:error={(e) => e.currentTarget.style.display = 'none'} />
                    <div>
                        <div class="stat-value">{stats.topArtist.name}</div>
                    </div>
                </div>
            </div>
            {/if}

        </div>
    {:else}
        <div class="empty-state">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <h2>No listening data for this period.</h2>
            <p>Start spinning some tracks to build your Wrapped profile!</p>
        </div>
    {/if}
</div>

<style>
    .wrapped-header {
        padding: 48px;
        padding-bottom: 24px;
        position: relative;
        z-index: 2;
    }
    .duration-toggles {
        display: flex;
        gap: 8px;
        margin-top: 24px;
        background: rgba(255,255,255,0.05);
        padding: 6px;
        border-radius: 20px;
        width: fit-content;
    }
    .duration-toggles button {
        background: transparent;
        border: none;
        color: rgba(255,255,255,0.6);
        padding: 8px 16px;
        border-radius: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
    }
    .duration-toggles button:hover {
        color: white;
    }
    .duration-toggles button.active {
        background: white;
        color: black;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    
    .content-container {
        padding: 0 48px 48px 48px;
        position: relative;
        z-index: 2;
    }
    
    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 24px;
    }

    .stat-card {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: 24px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        backdrop-filter: blur(20px);
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }

    .stat-card.standout {
        grid-column: 1 / -1;
        background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01));
        border: 1px solid var(--accent-color);
        box-shadow: 0 10px 40px rgba(var(--accent-color-rgb), 0.1);
    }
    
    .stat-label {
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 2px;
        font-weight: 800;
        color: var(--accent-color);
    }

    .stat-content {
        display: flex;
        align-items: center;
        gap: 20px;
    }

    .track-icon-placeholder {
        width: 80px;
        height: 80px;
        background: rgba(255,255,255,0.05);
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--accent-color);
    }

    .stat-content img {
        width: 80px;
        height: 80px;
        object-fit: cover;
        border-radius: 16px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }

    .stat-content img.artist-img {
        border-radius: 50%;
    }

    .stat-value {
        font-size: 24px;
        font-weight: 800;
        color: white;
        line-height: 1.2;
    }

    .stat-value.huge {
        font-size: 64px;
        letter-spacing: -2px;
        background: linear-gradient(to right, #fff, var(--accent-color));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }

    .loading-state, .empty-state {
        padding: 64px 0;
        text-align: center;
        color: rgba(255,255,255,0.5);
        font-weight: 600;
    }

    .empty-state svg {
        margin-bottom: 24px;
        opacity: 0.5;
    }
    .empty-state h2 {
        color: white;
        margin: 0 0 8px 0;
    }
</style>
