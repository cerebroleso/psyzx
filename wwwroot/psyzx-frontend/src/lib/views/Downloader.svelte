<script>
    import { onMount, onDestroy } from 'svelte';
    import { api } from '../api.js';

    let dlUrl = '';
    let queueStatus = '🟢 Arch Server Ready';
    let dlStatus = '';
    let isProcessing = false;
    let queueInterval;

    const updateQueue = async () => {
        try {
            const data = await api.getQueue();
            if (data) {
                if (data.active > 0 || data.queued > 0) {
                    isProcessing = true;
                    queueStatus = `<div style="color: #fbbf24; margin-bottom: 8px;">⚙️ Processing: ${data.active} | ⏳ Queued: ${data.queued}</div><div style="color: var(--accent-color);">🎵 Track: ${data.currentTrack || "Fetching metadata..."}</div>`;
                } else {
                    isProcessing = false;
                    queueStatus = `🟢 Arch Server Ready`;
                }
            }
        } catch(e) {}
    };

    onMount(() => {
        updateQueue();
        queueInterval = setInterval(updateQueue, 1500);
    });

    onDestroy(() => {
        clearInterval(queueInterval);
    });

    const startDownload = async () => {
        if (!dlUrl) return;
        dlStatus = '<span style="color: var(--text-secondary);">Invio al server...</span>';
        try {
            const res = await api.ytdlp({ url: dlUrl });
            if (res.ok) { 
                dlStatus = `<span style="color: #1db954;">${res.data.text}</span>`; 
                dlUrl = ''; 
                updateQueue(); 
            } else { 
                dlStatus = `<span style="color: #ef4444;">Errore: ${res.data.text}</span>`; 
            }
        } catch(e) { 
            dlStatus = `<span style="color: #ef4444;">Errore di rete.</span>`; 
        }
    };

    const stopDownload = async () => {
        try {
            const data = await api.stopQueue();
            dlStatus = `<span style="color: #ef4444;">${data.text}</span>`;
            updateQueue();
        } catch(e) { 
            dlStatus = `<span style="color: #ef4444;">Impossibile fermare.</span>`; 
        }
    };
</script>

<div style="padding: 64px 24px; max-width: 800px; margin: 0 auto; width: 100%;">
    <h2 style="font-size: 40px; margin-bottom: 24px; font-weight: 900; letter-spacing: -1px;">Import Music</h2>
    <p style="color: var(--text-secondary); margin-bottom: 32px;">Incolla un link YouTube. Il server Arch gestirà il download e l'aggiunta al database in background.</p>
    
    <div style="background: var(--surface-color); padding: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 16px 32px rgba(0,0,0,0.5);">
        <input type="text" placeholder="https://youtube.com/watch?v=..." bind:value={dlUrl} style="width: 100%; padding: 16px; background: rgba(0,0,0,0.5); border: 1px solid #333; color: #fff; border-radius: 4px; margin-bottom: 24px; font-size: 16px; outline: none;">
        
        <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 24px;">
            <button on:click={startDownload} style="padding: 16px 32px; background: var(--accent-color); color: #000; border: none; border-radius: 32px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>
                Fetch & Download
            </button>
            <button aria-label="Stop" on:click={stopDownload} style="padding: 16px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid #ef4444; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Halt all operations">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
            </button>
        </div>
        
        <div style="font-size: 13px; font-family: monospace; font-weight: 600; padding: 16px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid {isProcessing ? 'rgba(251, 191, 36, 0.3)' : 'rgba(217, 70, 239, 0.3)'}; word-break: break-all;">
            {@html queueStatus}
        </div>
        <div style="margin-top: 16px; font-size: 14px; font-weight: 600;">
            {@html dlStatus}
        </div>
    </div>
</div>