<script>
    import { onMount, onDestroy } from 'svelte';
    
    export let isMobileOpen = false;
    export let currentHash = '';

    let memory = '0 MB';
    let logs = ['[System] Boot Sequence OK', '[Net] Connection Stable'];
    let interval;

    onMount(() => {
        interval = setInterval(() => {
            if (performance && performance.memory) {
                memory = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + ' MB';
            } else {
                memory = Math.floor(Math.random() * 30 + 50) + ' MB';
            }
            if (Math.random() > 0.7) {
                const msgs = ['[Audio] Buffer Flushed', '[Cache] Validated', '[API] Ping 24ms', '[Sys] Worker Active'];
                logs = [...logs.slice(-2), msgs[Math.floor(Math.random() * msgs.length)]];
            }
        }, 2500);
    });

    onDestroy(() => clearInterval(interval));

    const menu = [
        { id: '', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', text: 'Home' },
        { id: '#top', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', text: 'Top Played' },
        { id: '#all', icon: 'M4 22h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2zm10-20v20', text: 'The Pool' },
        { id: '#offline', icon: 'M12 17V3M6 11l6 6 6-6M19 21H5', text: 'Available Offline' },
        { id: '#downloader', icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', text: 'Downloader' },
        { id: '#settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z', text: 'Settings' }
    ];
</script>

<aside class:open={isMobileOpen}>
    <div class="logo">
        <svg viewBox="-2 -2 28 28" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
        <h2>psyzx</h2>
    </div>

    <nav>
        {#each menu as item}
            <a href="{item.id}" class:active={currentHash === item.id || (item.id === '' && currentHash === '#/')} on:click={() => isMobileOpen = false}>
                <svg viewBox="-2 -2 28 28" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="{item.icon}"></path></svg>
                <span>{item.text}</span>
            </a>
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
    aside {
        display: flex; flex-direction: column; width: 240px; padding: 24px;
        box-sizing: border-box; flex-shrink: 0; transition: transform 0.3s;
        height: 100%; overflow-y: auto; overflow-x: hidden;
        padding-bottom: 100px;
    }
    .logo { display: flex; align-items: center; gap: 12px; margin-bottom: 40px; color: white; flex-shrink: 0; }
    .logo h2 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -1px; }
    nav { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
    a {
        display: flex; align-items: center; gap: 16px; padding: 12px 16px; color: rgba(255,255,255,0.7);
        text-decoration: none; border-radius: 12px; transition: all 0.2s; font-weight: 600; font-size: 14px;
    }
    a:hover { color: white; background: rgba(255,255,255,0.1); }
    a.active { 
        color: black; 
        background: white; 
        box-shadow: 0 4px 12px rgba(0,0,0,0.2); 
    }
    a.active svg { color: var(--accent-color); }
    
    .sys-monitor {
        padding: 16px; border-radius: 12px; background: rgba(0,0,0,0.2);
        border: 1px solid rgba(255,255,255,0.05); font-family: monospace; font-size: 11px;
        flex-shrink: 0;
    }
    .sys-title { color: var(--accent-color); font-weight: 900; margin-bottom: 8px; letter-spacing: 1px; }
    .sys-stat { display: flex; justify-content: space-between; color: rgba(255,255,255,0.7); margin-bottom: 8px; }
    .highlight { color: white; font-weight: bold; }
    .sys-logs { color: rgba(255,255,255,0.4); display: flex; flex-direction: column; gap: 4px; }
    .version { margin-top: 24px; text-align: center; font-size: 11px; color: rgba(255,255,255,0.3); flex-shrink: 0; }
    
    @media (max-width: 768px) {
        aside { 
            position: fixed; top: 0; left: 0; height: 100dvh; transform: translateX(-100%); 
            z-index: 100005; background: #050505; padding-bottom: 120px;
        }
        aside.open { transform: translateX(0); }
    }
</style>