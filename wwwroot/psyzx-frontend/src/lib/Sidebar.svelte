<script>
    import { onMount, onDestroy } from 'svelte';
    import { fade } from 'svelte/transition';
    
    export let isMobileOpen = false;
    export let currentHash = '';

    let innerWidth = 0;
    let memory = '0 MB';
    let logs = ['[System] Boot Sequence OK', '[Net] Connection Stable'];
    let interval;

    $: isMobile = innerWidth <= 768;

    let isClosing = false;
    let visualHash = currentHash;

    // Only allow visualHash to follow currentHash when the sidebar is 
    // fully settled and open. This prevents the "jump" during exit.
    $: if (isMobileOpen && !isClosing) {
        visualHash = currentHash;
    }

    // Change your reactive block to be simpler
    // If we are closing, we REFUSE to update the visualHash
    $: if (!isClosing) {
        visualHash = currentHash;
    }

    const closeSidebar = () => {
        // We set isClosing FIRST to lock the visualHash immediately
        isClosing = true;
        isMobileOpen = false;

        // Reset everything once the sidebar is physically gone
        setTimeout(() => {
            isClosing = false;
            visualHash = currentHash; 
        }, 400); // 400ms to be safe (transition is 300ms)
    };

    const handleNav = (id) => {
        if (isMobile) {
            isClosing = true;
            isMobileOpen = false;
            
            // Navigate immediately
            window.location.hash = id;

            // Unlock only after sidebar is gone
            setTimeout(() => {
                isClosing = false;
            }, 400);
        } else {
            window.location.hash = id;
        }
    };

    const handleKeydown = (e) => {
        if (e.key === 'Escape') closeSidebar();
    };

    onMount(() => {
        window.addEventListener('keydown', handleKeydown);
        interval = setInterval(() => {
            const mem = performance['memory'];
            if (mem && mem['usedJSHeapSize']) {
                memory = Math.round(mem['usedJSHeapSize'] / 1024 / 1024) + ' MB';
            } else {
                memory = Math.floor(Math.random() * 30 + 50) + ' MB';
            }
            if (Math.random() > 0.7) {
                const msgs = ['[Audio] Buffer Flushed', '[Cache] Validated', '[API] Ping 24ms', '[Sys] Worker Active'];
                logs = [...logs.slice(-2), msgs[Math.floor(Math.random() * msgs.length)]];
            }
        }, 2500);
    });

    onDestroy(() => {
        window.removeEventListener('keydown', handleKeydown);
        clearInterval(interval);
    });

    // AGGIUNTA LA VOCE PLAYLISTS QUI SOTTO
    const menu = [
        { id: '#/', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', text: 'Home' },
        { id: '#top', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', text: 'Top Played' },
        { id: '#wrapped', icon: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M15 2H9v4h6V2zM12 11v8M9 14l3-3 3 3', text: 'My Wrapped' },
        { id: '#all', icon: 'M4 22h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2zm10-20v20', text: 'The Pool' },
        { id: '#playlists', icon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', text: 'Playlists' },
        { id: '#offline', icon: 'M12 17V3M6 11l6 6 6-6M19 21H5', text: 'Available Offline' },
        { id: '#downloader', icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', text: 'Downloader' },
        { id: '#account', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', text: 'Account' },
        { id: '#settings', icon: 'M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 13.96 2h-3.92c-.29 0-.5.18-.54.45l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.04.27.25.45.54.45h3.92c.29 0 .5-.18.54-.45l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z', text: 'Settings' }
    ];

    // WS1: Drag-and-drop target state for Playlists nav item
    let isDragOverPlaylists = false;
    let dragHoverTimer = null;

    const onPlaylistsDragEnter = (e) => {
        e.preventDefault();
        isDragOverPlaylists = true;
        // After 600ms hover, auto-navigate to Playlists view
        clearTimeout(dragHoverTimer);
        dragHoverTimer = setTimeout(() => {
            if (isDragOverPlaylists) {
                window.location.hash = '#playlists';
            }
        }, 600);
    };

    const onPlaylistsDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };

    const onPlaylistsDragLeave = () => {
        isDragOverPlaylists = false;
        clearTimeout(dragHoverTimer);
    };

    const onPlaylistsDrop = (e) => {
        e.preventDefault();
        isDragOverPlaylists = false;
        clearTimeout(dragHoverTimer);
        try {
            const trackIds = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (Array.isArray(trackIds) && trackIds.length > 0) {
                // Navigate to playlists and dispatch the pending drop event
                window.location.hash = '#playlists';
                // Small delay so Playlists.svelte has time to mount
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('playlist-drop-pending', { detail: { trackIds } }));
                }, 300);
            }
        } catch {}
    };
</script>

<svelte:window bind:innerWidth />

{#if isMobile && isMobileOpen}
    <div class="backdrop" on:click={closeSidebar} transition:fade={{ duration: 200 }} role="presentation"></div>
{/if}

<aside class:open={isMobileOpen}>
    <div class="logo">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
        <h2>psyzx</h2>
        
        {#if isMobile}
            <button class="close-trigger" on:click={closeSidebar} aria-label="Close menu">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        {/if}
    </div>

    <nav>
        {#each menu as item}
            {#if item.id === '#playlists'}
                <a 
                    href={item.id}
                    class:active={visualHash === item.id}
                    class:drag-target={isDragOverPlaylists}
                    on:click|preventDefault={() => handleNav(item.id)}
                    on:dragenter={onPlaylistsDragEnter}
                    on:dragover={onPlaylistsDragOver}
                    on:dragleave={onPlaylistsDragLeave}
                    on:drop={onPlaylistsDrop}
                >
                    <span class="icon-wrap">
                        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="{item.icon}"></path>
                        </svg>
                    </span>
                    <span>{item.text}</span>
                </a>
            {:else}
                <a 
                    href={item.id}
                    class:active={visualHash === item.id || (item.id === '#/' && (visualHash === '' || visualHash === '#/'))} 
                    on:click|preventDefault={() => handleNav(item.id)}
                >
                    <span class="icon-wrap">
                        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="{item.icon}"></path>
                        </svg>
                    </span>
                    <span>{item.text}</span>
                </a>
            {/if}
        {/each}
    </nav>
    
    <div class="spacer" style="flex-grow: 1; min-height: 24px;"></div>

    <div class="sys-monitor">
        <div class="sys-title">SYSTEM MONITOR</div>
        <div class="sys-stat"><span>RAM</span> <span class="highlight">{memory}</span></div>
        <div class="sys-logs">
            {#each logs as log}
                <div>{log}</div>
            {/each}
        </div>
    </div>

    <div class="version">psyzx v3.0 - Svelte</div>
</aside>

<style>
    /* ... (Il tuo CSS della Sidebar rimane identico) ... */
    .backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 100004; cursor: pointer; pointer-events: auto;}
    aside { display: flex; flex-direction: column; width: 240px; padding: 24px; box-sizing: border-box; flex-shrink: 0; transform: translate3d(0, 0, 0); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); will-change: transform; height: 100%; overflow-y: auto; overflow-x: hidden; padding-bottom: 120px; background: #050505; border-right: 1px solid rgba(255,255,255,0.05); contain: paint; }
    .logo { display: flex; align-items: center; gap: 12px; margin-bottom: 40px; color: white; }
    .logo h2 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -1px; flex-grow: 1; }
    .close-trigger { background: rgba(255,255,255,0.05); border: none; color: white; cursor: pointer; padding: 8px; border-radius: 50%; display: flex; align-items: center; }
    nav { display: flex; flex-direction: column; gap: 4px; }
    a {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        color: rgba(255,255,255,0.6);
        text-decoration: none;
        border-radius: 12px;
        /* CHANGE: Only transition color, not background or box-shadow */
        transition: color 0.2s ease; 
        font-weight: 600;
        font-size: 14px;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
    }

    /* Ensure the active state has zero transitions */
    a.active {
        color: black;
        background: white;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        transition: none !important; 
    }
    .icon-wrap { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; }
    a:hover { color: white; background: rgba(255,255,255,0.05); }
    a.active {
        color: black;
        background: white;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        /* Disable background transition when it becomes active 
        to make it feel snappy, or keep it consistent */
        transition: none !important; 
    }    
    a.active svg { color: var(--accent-color); }
    .sys-monitor { padding: 16px; border-radius: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); font-family: monospace; font-size: 11px; }
    .sys-title { color: var(--accent-color); font-weight: 900; margin-bottom: 8px; letter-spacing: 1px; }
    .sys-stat { display: flex; justify-content: space-between; color: rgba(255,255,255,0.7); margin-bottom: 8px; }
    .highlight { color: white; font-weight: bold; }
    .sys-logs { color: rgba(255,255,255,0.3); display: flex; flex-direction: column; gap: 4px; }
    .version { margin-top: 24px; margin-bottom: 40px; text-align: center; font-size: 11px; color: rgba(255,255,255,0.2); }
    @media (max-width: 768px) {
        aside { position: fixed; top: 0; left: 0; height: 100dvh; transform: translate3d(-110%, 0, 0); z-index: 100005; border-right: none; backface-visibility: hidden; visibility: hidden; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), visibility 0s 0.3s; transform: translate3d(-105%, 0, 0); 
        will-change: transform;
        /* Ensure no flickering during movement */
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        pointer-events: none;}
        aside.open { transform: translate3d(0, 0, 0) !important; box-shadow: 20px 0 50px rgba(0,0,0,0.8); visibility: visible; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), visibility 0s 0s;         pointer-events: auto !important;}
    }

    /* WS1: Drag-and-drop target glow on Playlists item */
    a.drag-target {
        color: var(--accent-color, #60a5fa) !important;
        background: rgba(96, 165, 250, 0.12) !important;
        box-shadow: 0 0 0 2px var(--accent-color, #60a5fa), 0 0 20px rgba(96, 165, 250, 0.25) !important;
        border-radius: 12px;
        transition: all 0.2s ease !important;
    }
    a.drag-target svg {
        color: var(--accent-color, #60a5fa) !important;
    }
</style>