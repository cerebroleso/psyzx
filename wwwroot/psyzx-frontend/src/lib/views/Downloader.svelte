<script>
    import { onMount, onDestroy } from 'svelte';
    import { fade } from 'svelte/transition';
    import { api } from '../api.js';
    import { activeDownloads } from '../../store.js';

    let dlUrl = '';
    let dlStatus = '';

    // This is the magic: it reacts to the global poller in App.svelte
    $: isProcessing = $activeDownloads.length > 0;

    // Dynamically build the status string based on the store
    $: queueStatus = isProcessing
        ? `<div style="color: #fbbf24; margin-bottom: 8px;">⚙️ Processing Track...</div>`
        : `Server Ready`;

    let placeholderInterval;
    let placeholder = "https://open.spotify.com/track/..."

    const swap_placeholder = async () => {
        if (placeholder.includes("spotify")) {
            placeholder = "https://youtube.com/watch?v=..."
        } else {
            placeholder = "https://open.spotify.com/track/..."
        }
    }

    onMount(() => {
        placeholderInterval = setInterval(swap_placeholder, 3000);
    });

    onDestroy(() => {
        clearInterval(placeholderInterval);
    });

    const startDownload = async () => {
        if (!dlUrl) return;
        dlStatus = '<span style="color: var(--text-secondary);">Sending to server...</span>';
        try {
            const res = await api.ytdlp({ url: dlUrl });
            if (res.ok) {
                // Tell App.svelte to speed up polling immediately
                window.dispatchEvent(new CustomEvent('poll-check-immediate'));
                dlUrl = '';
                dlStatus = `<span style="color: #1db954;">Added to queue.</span>`;
            } else {
                dlStatus = `<span style="color: #ef4444;">Error starting download.</span>`;
            }
        } catch(e) {
            dlStatus = `<span style="color: #ef4444;">Network error.</span>`;
        }
    };

    const stopDownload = async () => {
        try {
            await api.stopQueue();
            dlStatus = `<span style="color: #ef4444;">Queue cleared.</span>`;
            // Trigger immediate poll to update UI
            window.dispatchEvent(new CustomEvent('poll-check-immediate'));
        } catch(e) {
            dlStatus = `<span style="color: #ef4444;">Stop action denied.</span>`;
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') startDownload();
    };
</script>

<div class="page-container">
    <h2 class="title">Import Music</h2>
    <p class="subtitle">Paste Youtube or Spotify link. <br><br> The server will manage the download and background operations.</p>

    <div class="card">
        <div class="input-wrapper">
            <input
                type="text"
                bind:value={dlUrl}
                on:keydown={handleKeyDown}
                class="main-input"
            >

            {#if !dlUrl}
                <div class="ghost-container">
                    {#key placeholder}
                        <span in:fade={{ duration: 400 }} out:fade={{ duration: 400 }} class="ghost-text">
                            {placeholder}
                        </span>
                    {/key}
                </div>
            {/if}
        </div>

        <div class="button-group">
            <button on:click={startDownload} class="btn-primary">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>
                <span>Fetch & Download</span>
            </button>
            <button aria-label="Stop" on:click={stopDownload} class="btn-stop" title="Halt all operations">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
            </button>
        </div>

        <div class="status-box" style="border-color: {isProcessing ? 'rgba(251, 191, 36, 0.3)' : 'rgba(217, 70, 239, 0.3)'}">
            {@html queueStatus}
        </div>
        <div class="dl-status">
            {@html dlStatus}
        </div>
    </div>
</div>

<style>
    .page-container {
        padding: 40px 20px; /* Reduced top padding for mobile */
        max-width: 800px;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;
    }

    .title {
        font-size: 28px; /* Smaller for mobile */
        margin-bottom: 16px;
        font-weight: 900;
        letter-spacing: -1px;
    }

    .subtitle {
        color: var(--text-secondary);
        margin-bottom: 24px;
        font-size: 14px;
        line-height: 1.5;
    }

    .card {
        background: var(--surface-color);
        padding: 20px; /* Reduced from 32px */
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.05);
        box-shadow: 0 16px 32px rgba(0,0,0,0.5);
    }

    .input-wrapper {
        position: relative;
        width: 100%;
        margin-bottom: 20px;
    }

    .main-input {
        width: 100%;
        padding: 14px;
        background: rgba(0,0,0,0.5);
        border: 1px solid #333;
        color: #fff;
        border-radius: 8px;
        font-size: 16px;
        outline: none;
        position: relative;
        z-index: 1;
        box-sizing: border-box;
    }

    .ghost-container {
        position: absolute;
        top: 0;
        left: 15px;
        height: 100%;
        display: flex;
        align-items: center;
        color: #777;
        pointer-events: none;
        z-index: 3;
        width: calc(100% - 30px);
        overflow: hidden; /* Important so long links don't break the card */
    }

    .ghost-text {
        position: absolute;
        white-space: nowrap;
        font-size: 14px; /* Slightly smaller for mobile fit */
        text-overflow: ellipsis;
        overflow: hidden;
    }

    .button-group {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-bottom: 20px;
    }

    .btn-primary {
        flex: 1; /* Main button grows to fill space */
        padding: 14px 20px;
        background: rgba(105, 0, 121, 0.2);
        color: #000;
        border: none;
        border-radius: 12px;
        font-weight: bold;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-size: 15px;
        white-space: nowrap;
    }

    .btn-stop {
        width: 48px;
        height: 48px;
        flex-shrink: 0;
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border: 1px solid #ef4444;
        border-radius: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .status-box {
        font-size: 12px;
        font-family: monospace;
        font-weight: 600;
        padding: 12px;
        border-radius: 8px;
        background: rgba(255,255,255,0.05);
        border: 1px solid;
        word-break: break-all;
    }

    .dl-status {
        margin-top: 12px;
        font-size: 13px;
        font-weight: 600;
    }

    /* Desktop Adjustments */
    @media (min-width: 640px) {
        .page-container { padding: 64px 24px; }
        .title { font-size: 40px; }
        .card { padding: 32px; }
        .btn-primary { flex: 0 1 auto; padding: 16px 32px; }
        .ghost-text { font-size: 16px; }
    }
</style>
