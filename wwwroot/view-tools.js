import { DOM } from './dom.js';
import { state } from './state.js';
import { formatTime, getCorporateFooter } from './utils.js';
import { attachTrackEvents } from './player.js';
import { navigateTo } from './router.js';
import { api } from './api.js';
import { setVolumeBoost } from './audio.js';

export const renderLyrics = async () => {
    DOM.btnBack.disabled = false;
    DOM.btnBack.onclick = () => navigateTo('');
    DOM.navContext.textContent = 'Lyrics';

    if (state.currentIndex < 0) {
        DOM.mainContent.innerHTML = `<div style="padding: 48px; text-align: center; color: var(--text-secondary);">Play a track first.</div>`;
        return;
    }

    DOM.mainContent.innerHTML = `<div style="padding: 48px; text-align: center;"><div class="spinner" style="margin: 0 auto;"></div></div>`;
    const track = state.currentPlaylist[state.currentIndex];
    const rawLyrics = await api.getLyrics(track.id);

    if (!rawLyrics) {
        DOM.mainContent.innerHTML = `<div style="padding: 48px; text-align: center; color: var(--text-secondary);">No lyrics found in Arch database.</div>`;
        return;
    }

    const lines = rawLyrics.split('\n').map(line => {
        const match = line.match(/\[(\d+):(\d+\.\d+)\](.*)/);
        if (match) return { time: parseInt(match[1]) * 60 + parseFloat(match[2]), text: match[3] || '...' };
        return null;
    }).filter(l => l);

    if (lines.length === 0) {
        DOM.mainContent.innerHTML = `<div style="padding: 48px; text-align: center; color: var(--text-secondary); white-space: pre-wrap;">${rawLyrics}</div>`;
        return;
    }

    DOM.mainContent.innerHTML = `<div id="lyrics-display" style="padding: 40px 24px; padding-bottom: 200px; display: flex; flex-direction: column; gap: 16px;">${lines.map(l => `<div class="lrc-line" data-time="${l.time}">${l.text}</div>`).join('')}</div>`;
};

export const renderSearch = (query) => {
    DOM.btnBack.disabled = false;
    DOM.btnBack.onclick = () => {
        if(DOM.searchInput) DOM.searchInput.value = '';
        navigateTo('');
    };
    DOM.navContext.textContent = `Search`;

    const results = state.allTracks.filter(t => {
        const album = state.albumsMap.get(t.albumId);
        return t.title.toLowerCase().includes(query) || album.artistName.toLowerCase().includes(query) || album.title.toLowerCase().includes(query);
    });

    DOM.mainContent.innerHTML = `
        <div style="padding: 24px 24px 0 24px;"><h2 style="font-size: 24px; font-weight: 800; margin-bottom: 24px;">Results for "${query}"</h2></div>
        <div class="list-container active-view" id="tracks-container"><div class="list-header"><div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;">Time</div></div></div>
    `;

    const container = document.getElementById('tracks-container');
    
    if (results.length === 0) {
        container.innerHTML = `
            <div style="padding: 48px 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px;">
                <div style="color: var(--text-secondary); margin-bottom: 8px;">Track not found in local database.</div>
                <button id="btn-yt-search" style="padding: 12px 24px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid #ef4444; border-radius: 24px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33 2.78 2.78 0 0 0 1.94 2c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.33 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
                    Fetch from YouTube
                </button>
                <div id="yt-search-status" style="font-size: 13px; font-weight: 600; margin-top: 8px;"></div>
            </div>
        `;

        document.getElementById('btn-yt-search').addEventListener('click', async () => {
            const status = document.getElementById('yt-search-status');
            status.innerHTML = '<span style="color: var(--text-secondary);">Searching & queueing... ⏳</span>';
            try {
                const safeQuery = query.replace(/["']/g, '');
                const res = await api.ytdlp({ url: `ytsearch1:${safeQuery}` });
                if (res.ok) status.innerHTML = `<span style="color: #1db954;">Added to Arch server queue! 🚀</span>`;
                else status.innerHTML = `<span style="color: #ef4444;">Error: ${res.data.text}</span>`;
            } catch(e) { status.innerHTML = `<span style="color: #ef4444;">Network Error.</span>`; }
        });
        return;
    }

    results.forEach((track, index) => {
        const album = state.albumsMap.get(track.albumId);
        const item = document.createElement('div');
        item.className = 'list-item';
        if (state.currentPlaylist.length > 0 && state.currentPlaylist[state.currentIndex]?.id === track.id) item.classList.add('active');
        item.innerHTML = `
            <div class="swipe-bg"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>
            <div class="list-item-content">
                <div class="list-item-num">${index + 1}</div>
                <div style="min-width: 0;">
                    <div class="list-item-title">${track.title}</div>
                    <div class="list-item-artist">${album.artistName} • ${album.title}</div>
                </div>
                <div class="list-item-time">${formatTime(track.durationSeconds)}</div>
            </div>
        `;
        attachTrackEvents(item, track, results, index);
        container.appendChild(item);
    });
};

export const renderDownloader = () => {
    DOM.btnBack.disabled = false;
    DOM.btnBack.onclick = () => {
        clearInterval(state.queueInterval);
        navigateTo('');
    };
    DOM.navContext.textContent = 'Downloader';

    DOM.mainContent.innerHTML = `
        <div style="padding: 64px 24px; max-width: 800px; margin: 0 auto; width: 100%;">
            <h2 style="font-size: 40px; margin-bottom: 24px; font-weight: 900; letter-spacing: -1px;">Import Music</h2>
            <p style="color: var(--text-secondary); margin-bottom: 32px;">Incolla un link YouTube. Il server Arch gestirà il download e l'aggiunta al database in background.</p>
            <div style="background: var(--surface-color); padding: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 16px 32px rgba(0,0,0,0.5);">
                <input type="text" id="dl-url" placeholder="https://youtube.com/watch?v=..." style="width: 100%; padding: 16px; background: rgba(0,0,0,0.5); border: 1px solid #333; color: #fff; border-radius: 4px; margin-bottom: 24px; font-size: 16px; outline: none;">
                <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 24px;">
                    <button id="btn-do-dl" style="padding: 16px 32px; background: var(--accent-color); color: #000; border: none; border-radius: 32px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 8px;"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>Fetch & Download</button>
                    <button id="btn-stop-dl" style="padding: 16px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid #ef4444; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Halt all operations"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg></button>
                </div>
                <div id="queue-status" style="font-size: 13px; font-family: monospace; font-weight: 600; padding: 16px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); word-break: break-all;">🟢 Arch Server Ready</div>
                <div id="dl-status" style="margin-top: 16px; font-size: 14px; font-weight: 600;"></div>
            </div>
        </div>
    `;

    const updateQueue = async () => {
        try {
            const data = await api.getQueue();
            const qBadge = document.getElementById('queue-status');
            if (qBadge && data) {
                if (data.active > 0 || data.queued > 0) {
                    qBadge.innerHTML = `<div style="color: #fbbf24; margin-bottom: 8px;">⚙️ Processing: ${data.active} | ⏳ Queued: ${data.queued}</div><div style="color: var(--accent-color);">🎵 Track: ${data.currentTrack || "Fetching metadata..."}</div>`;
                    qBadge.style.borderColor = 'rgba(251, 191, 36, 0.3)';
                } else {
                    qBadge.innerHTML = `🟢 Arch Server Ready`;
                    qBadge.style.borderColor = 'rgba(217, 70, 239, 0.3)';
                }
            }
        } catch(e) {}
    };

    clearInterval(state.queueInterval);
    updateQueue();
    state.queueInterval = setInterval(updateQueue, 1500);

    document.getElementById('btn-do-dl').addEventListener('click', async () => {
        const url = document.getElementById('dl-url').value;
        const status = document.getElementById('dl-status');
        if (!url) return;
        try {
            const res = await api.ytdlp({ url: url });
            if (res.ok) { status.innerHTML = `<span style="color: #1db954;">${res.data.text}</span>`; document.getElementById('dl-url').value = ''; updateQueue(); } 
            else { status.innerHTML = `<span style="color: #ef4444;">Errore: ${res.data.text}</span>`; }
        } catch(e) { status.innerHTML = `<span style="color: #ef4444;">Errore di rete.</span>`; }
    });

    document.getElementById('btn-stop-dl').addEventListener('click', async () => {
        const status = document.getElementById('dl-status');
        try {
            const data = await api.stopQueue();
            status.innerHTML = `<span style="color: #ef4444;">${data.text}</span>`;
            updateQueue();
        } catch(e) { status.innerHTML = `<span style="color: #ef4444;">Impossibile fermare.</span>`; }
    });

    DOM.mainContent.insertAdjacentHTML('beforeend', getCorporateFooter());
};

export const renderSettings = () => {
    DOM.btnBack.disabled = false;
    DOM.btnBack.onclick = () => navigateTo('');
    DOM.navContext.textContent = 'Settings';

    const currentBoost = localStorage.getItem('psyzx_boost') || '1.0';

    DOM.mainContent.innerHTML = `
        <div style="padding: 64px 24px; max-width: 800px; margin: 0 auto; width: 100%;">
            <h2 style="font-size: 40px; margin-bottom: 24px; font-weight: 900; letter-spacing: -1px;">System Settings</h2>
            
            <div style="background: var(--surface-color); padding: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
                <h3 style="color: var(--accent-color); margin-bottom: 8px;">Hardware Pre-Amp</h3>
                <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 24px;">Aumenta il guadagno hardware del player in locale. Bypassa i limiti del server senza corrompere il caching di iOS.</p>
                
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <span style="font-weight: 600;">Gain Multiplier</span>
                    <span id="boost-val" style="font-weight: 900; font-family: monospace; color: var(--accent-color);">${currentBoost}x</span>
                </div>
                <input type="range" id="boost-slider" min="0.5" max="3.0" step="0.1" value="${currentBoost}" style="width: 100%; height: 6px; border-radius: 3px; -webkit-appearance: none; background: rgba(255,255,255,0.2); outline: none;">
            </div>

            <div style="background: var(--surface-color); padding: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
                <h3 style="color: #ef4444; margin-bottom: 8px;">Nuke Local Cache</h3>
                <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 24px;">Distrugge Service Worker, Storage e Database locale. Usare solo in caso di emergenza o UI corrotta.</p>
                <button id="btn-nuke-cache" style="padding: 12px 24px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid #ef4444; border-radius: 24px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    Purge All Data
                </button>
            </div>
        </div>
    `;

    document.getElementById('boost-slider').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value).toFixed(1);
        document.getElementById('boost-val').textContent = val + 'x';
        localStorage.setItem('psyzx_boost', val);
        setVolumeBoost(val);
    });

    document.getElementById('btn-nuke-cache').addEventListener('click', async () => {
        if(confirm('Sei sicuro? Cancellerai tutti i brani scaricati offline e verrai sloggato.')) {
            localStorage.clear();
            try {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for(let reg of regs) await reg.unregister();
                }
            } catch(e) {}
            window.location.reload();
        }
    });

    DOM.mainContent.insertAdjacentHTML('beforeend', getCorporateFooter());
};