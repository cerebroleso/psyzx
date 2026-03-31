import { DOM } from './dom.js';
import { state } from './state.js';
import { api } from './api.js';
import { setupAudioEvents } from './audio.js';
import { setupPlayerEvents, loadState } from './player.js';
import { navigateTo } from './views.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const processData = (data) => {
    state.artistsMap.clear();
    state.albumsMap.clear();
    state.allTracks = data;
    data.forEach(track => {
        const artist = track.album.artist;
        const album = track.album;
        if (!state.artistsMap.has(artist.id)) state.artistsMap.set(artist.id, { id: artist.id, name: artist.name, imagePath: artist.imagePath, albums: new Set() });
        state.artistsMap.get(artist.id).albums.add(album.id);
        if (!state.albumsMap.has(album.id)) state.albumsMap.set(album.id, { id: album.id, title: album.title, coverPath: album.coverPath, releaseYear: album.releaseYear, playCount: album.playCount, artistId: artist.id, artistName: artist.name, tracks: [] });
        const currentAlbum = state.albumsMap.get(album.id);
        if (!currentAlbum.tracks.some(t => t.id === track.id)) currentAlbum.tracks.push(track);
    });
};

const renderRightSidebar = () => {
    if (!DOM.rightSidebar || !DOM.topAlbumsContainer) return;
    const topAlbums = Array.from(state.albumsMap.values()).sort((a, b) => b.playCount - a.playCount).slice(0, 8);
    DOM.topAlbumsContainer.innerHTML = '';
    topAlbums.forEach(album => {
        const el = document.createElement('div');
        el.className = 'top-album-item';
        const imgUrl = album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
        el.innerHTML = `<img src="${imgUrl}"><div><div class="title">${album.title}</div><div class="plays">${album.playCount} plays</div></div>`;
        el.addEventListener('click', () => navigateTo(`#album/${album.id}`));
        DOM.topAlbumsContainer.appendChild(el);
    });
};

const checkHealth = async () => {
    if(!DOM.systemHealth) return;
    setInterval(async () => {
        try {
            const startPing = performance.now();
            const data = await api.getStats();
            const latency = Math.round(performance.now() - startPing);
            const ramPct = Math.round((data.sysRamUsedMb / data.sysRamTotalMb) * 100);
            DOM.systemHealth.innerHTML = `<div style="margin-bottom:8px; font-weight:bold; color:var(--accent-color)">SYSTEM MONITOR</div><div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-family:monospace; font-size:10px;"><div>PING: ${latency}ms</div><div>FETCH: ${state.lastFetchTime}ms</div><div>APP RAM: ${data.appRamUsageMb}MB</div><div>SYS RAM: ${ramPct}%</div><div>THREADS: ${data.appThreads}</div><div>OS: Arch</div></div>`;
        } catch(e) { DOM.systemHealth.innerHTML = `<span style="color:#ef4444">●</span> Connection Lost`; }
    }, 3000);
};

const bootstrapApp = async () => {
    try {
        const data = await api.getTracks();
        if (!data || data.length === 0) {
            DOM.loaderOverlay.classList.remove('active');
            DOM.mainContent.innerHTML = `<div style="padding: 48px; text-align: center;"><h2>Libreria in aggiornamento ⏳</h2><p>Lo scanner è in azione sul backend. Ricarica tra poco.</p></div>`;
            return;
        }
        processData(data);
        renderRightSidebar();
        checkHealth();
        await navigateTo(window.location.hash);
        loadState();
        DOM.loaderOverlay.classList.remove('active');
    } catch (error) {
        DOM.loaderOverlay.classList.remove('active');
        DOM.mainContent.innerHTML = `<div style="padding: 48px; color: #ef4444; text-align: center;"><h2>Errore Backend</h2><p>${error.message}</p></div>`;
    }
};

if (DOM.loginForm) {
    DOM.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const res = await api.login(new FormData(e.target));
        if (res.ok) { DOM.loginOverlay.classList.add('hidden'); bootstrapApp(); }
        else alert('Credenziali errate');
    });
}

if (DOM.btnCancelEdit) {
    DOM.btnCancelEdit.addEventListener('click', () => {
        DOM.editModal.classList.add('hidden');
    });
}

if (DOM.editName && DOM.editImage) {
    DOM.editName.addEventListener('input', (e) => {
        const oldName = e.target.dataset.oldName;
        const newName = e.target.value;
        if (oldName && newName && DOM.editImage.value.includes(oldName)) {
            DOM.editImage.value = DOM.editImage.value.replace(oldName, newName);
        }
        e.target.dataset.oldName = newName;
    });
}

if (DOM.editForm) {
    DOM.editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = parseInt(DOM.editId.value);
        const type = DOM.editType.value;
        const name = DOM.editName.value;
        const image = DOM.editImage.value;
        
        DOM.editModal.classList.add('hidden');
        DOM.loaderOverlay.classList.add('active');
        
        let success = false;
        if (type === 'artist') {
            success = await api.updateArtist(id, name, image);
        } else if (type === 'album') {
            success = await api.updateAlbum(id, name, image);
        }
        
        if (success) {
            window.location.reload(); 
        } else {
            alert('Errore di salvataggio. Controlla che il backend Arch sia in ascolto sui nuovi endpoint.');
            DOM.loaderOverlay.classList.remove('active');
        }
    });
}

if (DOM.searchInput) {
    DOM.searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        window.location.hash = query.length > 0 ? `#search/${encodeURIComponent(query)}` : '';
    });
}

if (DOM.btnRefreshLib) {
    DOM.btnRefreshLib.addEventListener('click', async () => {
        DOM.loaderOverlay.classList.add('active');
        try { await api.scanLibrary(); window.location.reload(); } catch(e) {}
    });
}

if (DOM.btnLeftSidebar) {
    DOM.btnLeftSidebar.addEventListener('click', () => {
        if (DOM.sidebar) DOM.sidebar.classList.toggle('mobile-active');
    });
}

if (DOM.btnCloseSidebar) {
    DOM.btnCloseSidebar.addEventListener('click', () => {
        if (DOM.sidebar) DOM.sidebar.classList.remove('mobile-active');
    });
}

if (DOM.btnRightSidebar) {
    DOM.btnRightSidebar.addEventListener('click', () => {
        if(DOM.rightSidebar) DOM.rightSidebar.classList.add('mobile-active');
    });
}
if (DOM.btnCloseRightSidebar) {
    DOM.btnCloseRightSidebar.addEventListener('click', () => {
        if(DOM.rightSidebar) DOM.rightSidebar.classList.remove('mobile-active');
    });
}

DOM.navHome.addEventListener('click', (e) => {
    if (window.location.hash === '' || window.location.hash === '#') {
        e.preventDefault();
        navigateTo('');
    }
});

DOM.mainView.addEventListener('scroll', () => {
    if (DOM.mainView.scrollTop > 50) DOM.topbar.classList.add('scrolled');
    else DOM.topbar.classList.remove('scrolled');
});

window.addEventListener('hashchange', () => navigateTo(window.location.hash));

let touchStartX = 0, touchStartY = 0;
document.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; }, {passive: true});
document.addEventListener('touchend', e => {
    const diffX = touchStartX - e.changedTouches[0].clientX;
    const diffY = touchStartY - e.changedTouches[0].clientY;
    const isDesktop = window.innerWidth > 850;

    if (!isDesktop && touchStartX > 15 && touchStartX < window.innerWidth * 0.7 && diffX < -40 && Math.abs(diffY) < 40) {
        DOM.sidebar.classList.add('mobile-active');
    }
    if (!isDesktop && DOM.sidebar.classList.contains('mobile-active') && diffX > 40 && Math.abs(diffY) < 40) {
        DOM.sidebar.classList.remove('mobile-active');
    }
    
    if (DOM.rightSidebar && DOM.rightSidebar.classList.contains('mobile-active') && diffY < -50 && Math.abs(diffX) < 50) {
        DOM.rightSidebar.classList.remove('mobile-active');
    }

    if (DOM.player.contains(e.target) && diffY > 50 && Math.abs(diffX) < 50) {
        DOM.fullPlayer.classList.add('active');
        setTimeout(() => import('./player.js').then(p => p.recalcMarquees()), 300);
    }
    
    if (DOM.fullPlayer.classList.contains('active') && e.target.type !== 'range') {
        if (isDesktop && diffX < -50 && Math.abs(diffY) < 50) DOM.fullPlayer.classList.remove('active');
        if (!isDesktop && diffY < -50 && Math.abs(diffX) < 50) DOM.fullPlayer.classList.remove('active');
    }
});

DOM.playerMain.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    DOM.fullPlayer.classList.add('active');
    setTimeout(() => import('./player.js').then(p => p.recalcMarquees()), 300);
});
DOM.fpBtnClose.addEventListener('click', () => DOM.fullPlayer.classList.remove('active'));

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    if (e.code === 'Space') { 
        e.preventDefault(); 
        import('./player.js').then(p => p.togglePlay()); 
    }
    if (e.key === 'h') { 
        import('./player.js').then(p => p.playPrev()); 
    }
    if (e.key === 'l') { 
        import('./player.js').then(p => p.playNext()); 
    }
    if (e.key === 'k') { 
        import('./audio.js').then(a => a.syncVolume(Math.min(100, DOM.audioEl.volume * 100 + 10))); 
    }
    if (e.key === 'j') { 
        import('./audio.js').then(a => a.syncVolume(Math.max(0, DOM.audioEl.volume * 100 - 10))); 
    }
});

setupAudioEvents();
setupPlayerEvents();

api.checkAuth().then(isAuth => {
    if (isAuth) bootstrapApp();
    else { DOM.loginOverlay.classList.remove('hidden'); DOM.loaderOverlay.classList.remove('active'); }
});