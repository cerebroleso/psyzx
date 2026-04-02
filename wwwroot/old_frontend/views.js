import { DOM } from './dom.js';
import { state } from './state.js';
import { formatTime, getCorporateFooter } from './utils.js';
import { attachTrackEvents, playTrack, playNext } from './player.js';
import { api } from './api.js';

const setupOfflineMonitor = () => {
    if (document.getElementById('offline-monitor-styles')) return;

    const style = document.createElement('style');
    style.id = 'offline-monitor-styles';
    style.innerHTML = `
        #offline-toast { position: fixed; bottom: 120px; left: 50%; transform: translateX(-50%) translateY(50px); opacity: 0; pointer-events: none; background: rgba(24, 24, 24, 0.85); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(16px); padding: 12px 24px; border-radius: 32px; display: flex; align-items: center; gap: 12px; z-index: 9998; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); color: #fff; font-size: 14px; font-weight: 600; box-shadow: 0 16px 32px rgba(0,0,0,0.6); white-space: nowrap; }
        body.offline-mode #main-view { filter: brightness(0.4) grayscale(60%); transition: filter 0.3s ease; pointer-events: none; }
        body.offline-mode #offline-toast { transform: translateX(-50%) translateY(0); opacity: 1; }
        @media (max-width: 850px) { #offline-toast { bottom: 130px; font-size: 12px; padding: 10px 20px; } }
    `;
    document.head.appendChild(style);

    const toast = document.createElement('div');
    toast.id = 'offline-toast';
    toast.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 19.3a3.5 3.5 0 0 0 2.8 0"></path><path d="M4.6 13.3a10 10 0 0 1 14.8 0"></path><path d="M1.6 10.3a14 14 0 0 1 20.8 0"></path><line x1="2" y1="2" x2="22" y2="22"></line></svg><span>Connection lost. Playing from cache.</span>`;
    document.body.appendChild(toast);

    const updateStatus = () => {
        if (navigator.onLine) document.body.classList.remove('offline-mode');
        else document.body.classList.add('offline-mode');
    };

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
};

setupOfflineMonitor();

export const navigateTo = async (hash) => {
    if (DOM.sidebar.classList.contains('mobile-active')) DOM.sidebar.classList.remove('mobile-active');
    if (state.artistsMap.size === 0 && hash !== '#downloader') return;
    DOM.loaderOverlay.classList.add('active');
    await new Promise(r => setTimeout(r, 100));
    DOM.mainContent.innerHTML = '';
    DOM.mainView.scrollTop = 0;
    
    DOM.navHome.classList.remove('active');
    if(DOM.navTop) DOM.navTop.classList.remove('active');
    if(DOM.navAll) DOM.navAll.classList.remove('active');
    if(DOM.navDownloader) DOM.navDownloader.classList.remove('active');
    if(DOM.navOffline) DOM.navOffline.classList.remove('active');

    if (!hash || hash === '') { DOM.navHome.classList.add('active'); renderArtists(); }
    else if (hash === '#top') { if(DOM.navTop) DOM.navTop.classList.add('active'); renderTopPlayed(); }
    else if (hash === '#all') { if(DOM.navAll) DOM.navAll.classList.add('active'); renderAllTracks(); }
    else if (hash === '#downloader') { if(DOM.navDownloader) DOM.navDownloader.classList.add('active'); renderDownloader(); }
    else if (hash === '#offline') { if(DOM.navOffline) DOM.navOffline.classList.add('active'); await renderOfflineTracks(); }
    else if (hash === '#lyrics') { renderLyrics(); }
    else if (hash.startsWith('#search/')) renderSearch(decodeURIComponent(hash.split('/')[1]));
    else if (hash.startsWith('#artist/')) renderAlbums(parseInt(hash.split('/')[1]));
    else if (hash.startsWith('#album/')) renderTracks(parseInt(hash.split('/')[1]));

    DOM.loaderOverlay.classList.remove('active');
};

export const renderOfflineTracks = async () => {
    DOM.btnBack.disabled = false;
    DOM.btnBack.onclick = () => navigateTo('');
    DOM.navContext.textContent = 'Available Offline';

    DOM.mainContent.innerHTML = `<div style="padding: 48px; text-align: center;"><div class="spinner" style="margin: 0 auto;"></div></div>`;

    let offlineTracks = [];
    try {
        const cacheNames = await caches.keys();
        const mediaCacheName = cacheNames.find(n => n.includes('psyzx-media'));
        if (mediaCacheName) {
            const cache = await caches.open(mediaCacheName);
            const reqs = await cache.keys();
            const cachedUrls = reqs.map(req => req.url);
            offlineTracks = state.allTracks.filter(t => cachedUrls.some(url => url.includes(`/api/Tracks/stream/${t.id}`)));
        }
    } catch (e) {}

    offlineTracks.sort((a, b) => a.title.localeCompare(b.title));

    DOM.mainContent.innerHTML = `
        <div class="fade-bg"></div>
        <div class="album-hero">
            <div style="width:232px; height:232px; background: linear-gradient(135deg, #10b981, #000); border-radius:4px; display:flex; align-items:center; justify-content:center; box-shadow: 0 4px 60px rgba(0,0,0,0.5);">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path><path d="M12 12v9"></path><path d="m8 17 4 4 4-4"></path></svg>
            </div>
            <div class="album-info">
                <div class="album-type">Local Cache</div>
                <div class="album-title">Available Offline</div>
                <div class="album-meta"><strong>Downloaded Tracks</strong><span class="dot">•</span><span>${offlineTracks.length} songs</span></div>
            </div>
        </div>
        <div class="action-bar">
            <button class="btn-main-play" id="view-play-btn" ${offlineTracks.length === 0 ? 'disabled style="opacity:0.5"' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>
            <button class="btn-icon-bar ${state.isShuffle ? 'active' : ''}" id="view-shuffle-btn" ${offlineTracks.length === 0 ? 'disabled style="opacity:0.5"' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg></button>
        </div>
        <div class="list-container" id="tracks-container"><div class="list-header"><div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;">Time</div></div></div>
    `;

    if (offlineTracks.length > 0) {
        document.getElementById('view-play-btn').addEventListener('click', () => { 
            state.currentPlaylist = offlineTracks; 
            if(state.isShuffle) {
                 state.shuffleHistory = [];
                 import('./player.js').then(p => p.playTrack(Math.floor(Math.random() * offlineTracks.length)));
            } else {
                 import('./player.js').then(p => p.playTrack(0)); 
            }
        });
        
        const viewShuffleBtn = document.getElementById('view-shuffle-btn');
        viewShuffleBtn.addEventListener('click', () => {
            state.isShuffle = !state.isShuffle;
            viewShuffleBtn.classList.toggle('active', state.isShuffle);
            DOM.btnShuffle.classList.toggle('active', state.isShuffle);
            DOM.fpBtnShuffle.classList.toggle('active', state.isShuffle);
            
            state.currentPlaylist = offlineTracks;
            if (state.isShuffle) {
                state.shuffleHistory = [];
                import('./player.js').then(p => p.playTrack(Math.floor(Math.random() * offlineTracks.length)));
            } else {
                import('./player.js').then(p => p.playTrack(0));
            }
        });

        const list = document.getElementById('tracks-container');
        offlineTracks.forEach((track, index) => {
            const album = state.albumsMap.get(track.albumId);
            const item = document.createElement('div');
            item.className = 'list-item';
            if (state.currentPlaylist.length > 0 && state.currentPlaylist[state.currentIndex]?.id === track.id) item.classList.add('active');
            item.innerHTML = `<div class="list-item-content"><div class="list-item-num">${index + 1}</div><div style="min-width: 0;"><div class="list-item-title">${track.title}</div><div class="list-item-artist">${album ? album.artistName : 'Unknown'} • ${album ? album.title : 'Unknown'}</div></div><div class="list-item-time">${formatTime(track.durationSeconds || 0)}</div></div>`;
            attachTrackEvents(item, track, offlineTracks, index);
            list.appendChild(item);
        });
    } else {
        document.getElementById('tracks-container').innerHTML += `<div style="padding: 48px; text-align: center; color: var(--text-secondary);">No downloaded tracks found in cache.</div>`;
    }
    
    DOM.mainContent.insertAdjacentHTML('beforeend', getCorporateFooter());
};

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
        <div class="list-container" id="tracks-container"><div class="list-header"><div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;">Time</div></div></div>
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
        item.innerHTML = `<div class="list-item-content"><div class="list-item-num">${index + 1}</div><div style="min-width: 0;"><div class="list-item-title">${track.title}</div><div class="list-item-artist">${album.artistName} • ${album.title}</div></div><div class="list-item-time">${formatTime(track.durationSeconds)}</div></div>`;
        attachTrackEvents(item, track, results, index);
        container.appendChild(item);
    });
};

export const renderArtists = () => {
    DOM.btnBack.disabled = true;
    DOM.navContext.textContent = 'Library';

    const grid = document.createElement('div');
    grid.className = 'grid-container';

    Array.from(state.artistsMap.values()).sort((a, b) => a.name.localeCompare(b.name)).forEach(artist => {
        const card = document.createElement('div');
        card.className = 'card';
        const imgUrl = artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath)}&v=${state.appSessionVersion}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
        card.innerHTML = `<img src="${imgUrl}"><div class="card-title">${artist.name}</div>`;
        card.addEventListener('click', () => navigateTo(`#artist/${artist.id}`));
        grid.appendChild(card);
    });

    DOM.mainContent.appendChild(grid);
    DOM.mainContent.insertAdjacentHTML('beforeend', getCorporateFooter());
};

export const renderAlbums = (artistId) => {
    const artist = state.artistsMap.get(artistId);
    if (!artist) return navigateTo('');

    DOM.btnBack.disabled = false;
    DOM.btnBack.onclick = () => navigateTo('');
    DOM.navContext.textContent = artist.name;

    const imgUrl = artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath)}&v=${state.appSessionVersion}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';

    DOM.mainContent.innerHTML = `
        <div class="fade-bg"></div>
        <div class="album-hero">
            <div class="cover-wrapper artist-wrapper">
                <img src="${imgUrl}" style="border-radius: 50%; aspect-ratio: 1/1; object-fit: cover; width: 232px; height: 232px;">
                <button id="btn-edit-artist" class="edit-trigger" title="Edit Artist"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg></button>
            </div>
            <div class="album-info">
                <div class="album-type">Artist</div>
                <div class="album-title">${artist.name}</div>
                <div class="album-meta"><span>${artist.albums.size} albums</span></div>
            </div>
        </div>
        <div class="grid-container" id="albums-grid"></div>
    `;

    document.getElementById('btn-edit-artist').addEventListener('click', () => {
        DOM.editId.value = artist.id;
        DOM.editType.value = 'artist';
        DOM.editName.value = artist.name;
        DOM.editName.dataset.oldName = artist.name;
        DOM.editImage.value = artist.imagePath || '';
        DOM.editModalTitle.textContent = 'Modifica Artista';
        DOM.editModal.classList.remove('hidden');
    });

    const grid = document.getElementById('albums-grid');

    Array.from(artist.albums).forEach(albumId => {
        const album = state.albumsMap.get(albumId);
        const card = document.createElement('div');
        card.className = 'card';
        const albumImgUrl = album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&v=${state.appSessionVersion}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
        card.innerHTML = `<img src="${albumImgUrl}"><div class="card-title">${album.title}</div>`;
        card.addEventListener('click', () => navigateTo(`#album/${album.id}`));
        grid.appendChild(card);
    });

    DOM.mainContent.appendChild(grid);
    DOM.mainContent.insertAdjacentHTML('beforeend', getCorporateFooter());
};

export const renderTopPlayed = () => {
    DOM.btnBack.disabled = false;
    DOM.btnBack.onclick = () => navigateTo('');
    DOM.navContext.textContent = 'Top Played Tracks';

    const topTracks = [...state.allTracks].sort((a, b) => b.playCount - a.playCount).slice(0, 50);
    const topImgUrl = `/api/Tracks/image?path=most_listened.jpg`;

    DOM.mainContent.innerHTML = `
        <div class="fade-bg"></div>
        <div class="album-hero">
            <img src="${topImgUrl}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4='">
            <div class="album-info"><div class="album-type">Automated Playlist</div><div class="album-title">On Repeat</div><div class="album-meta"><strong>Your absolute favorites</strong><span class="dot">•</span><span>${topTracks.length} songs</span></div></div>
        </div>
        <div class="action-bar">
            <button class="btn-main-play" id="view-play-btn"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>
            <button class="btn-icon-bar ${state.isShuffle ? 'active' : ''}" id="view-shuffle-btn"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg></button>
        </div>
        <div class="list-container" id="tracks-container"><div class="list-header"><div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;">Plays</div></div></div>
    `;

    document.getElementById('view-play-btn').addEventListener('click', () => { 
        state.currentPlaylist = topTracks; 
        if(state.isShuffle) {
             state.shuffleHistory = [];
             import('./player.js').then(p => p.playTrack(Math.floor(Math.random() * topTracks.length)));
        } else {
             import('./player.js').then(p => p.playTrack(0)); 
        }
    });

    const viewShuffleBtn = document.getElementById('view-shuffle-btn');
    viewShuffleBtn.addEventListener('click', () => {
        state.isShuffle = !state.isShuffle;
        viewShuffleBtn.classList.toggle('active', state.isShuffle);
        DOM.btnShuffle.classList.toggle('active', state.isShuffle);
        DOM.fpBtnShuffle.classList.toggle('active', state.isShuffle);
        
        state.currentPlaylist = topTracks;
        if (state.isShuffle) {
            state.shuffleHistory = [];
            import('./player.js').then(p => p.playTrack(Math.floor(Math.random() * topTracks.length)));
        } else {
            import('./player.js').then(p => p.playTrack(0));
        }
    });

    const list = document.getElementById('tracks-container');
    topTracks.forEach((track, index) => {
        const album = state.albumsMap.get(track.albumId);
        const item = document.createElement('div');
        item.className = 'list-item';
        if (state.currentPlaylist.length > 0 && state.currentPlaylist[state.currentIndex]?.id === track.id) item.classList.add('active');
        item.innerHTML = `<div class="list-item-content"><div class="list-item-num">${index + 1}</div><div style="min-width: 0;"><div class="list-item-title">${track.title}</div><div class="list-item-artist">${album.artistName}</div></div><div class="list-item-time">${track.playCount}</div></div>`;
        attachTrackEvents(item, track, topTracks, index);
        list.appendChild(item);
    });

    DOM.mainContent.insertAdjacentHTML('beforeend', getCorporateFooter());
};

export const renderAllTracks = () => {
    DOM.btnBack.disabled = false;
    DOM.btnBack.onclick = () => navigateTo('');
    DOM.navContext.textContent = 'All Tracks';

    const poolTracks = [...state.allTracks].sort((a, b) => a.title.localeCompare(b.title));

    DOM.mainContent.innerHTML = `
        <div class="fade-bg"></div>
        <div class="album-hero">
            <div style="width:232px; height:232px; background: linear-gradient(135deg, var(--accent-color), #000); border-radius:4px; display:flex; align-items:center; justify-content:center; box-shadow: 0 4px 60px rgba(0,0,0,0.5);">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
            </div>
            <div class="album-info"><div class="album-type">Playlist</div><div class="album-title">The Pool</div><div class="album-meta"><strong>Everything you have</strong><span class="dot">•</span><span>${poolTracks.length} songs</span></div></div>
        </div>
        <div class="action-bar"><button class="btn-main-play" id="view-play-btn"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button><button class="btn-icon-bar ${state.isShuffle ? 'active' : ''}" id="view-shuffle-btn"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg></button></div>
        <div class="list-container" id="tracks-container"><div class="list-header"><div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;">Time</div></div></div>
    `;

    document.getElementById('view-play-btn').addEventListener('click', () => { 
        state.currentPlaylist = poolTracks; 
        if(state.isShuffle) {
             state.shuffleHistory = [];
             import('./player.js').then(p => p.playTrack(Math.floor(Math.random() * poolTracks.length)));
        } else {
             import('./player.js').then(p => p.playTrack(0)); 
        }
    });
    
    const viewShuffleBtn = document.getElementById('view-shuffle-btn');
    viewShuffleBtn.addEventListener('click', () => {
        state.isShuffle = !state.isShuffle;
        viewShuffleBtn.classList.toggle('active', state.isShuffle);
        DOM.btnShuffle.classList.toggle('active', state.isShuffle);
        DOM.fpBtnShuffle.classList.toggle('active', state.isShuffle);
        
        state.currentPlaylist = poolTracks;
        if (state.isShuffle) {
            state.shuffleHistory = [];
            import('./player.js').then(p => p.playTrack(Math.floor(Math.random() * poolTracks.length)));
        } else {
            import('./player.js').then(p => p.playTrack(0));
        }
    });

    const list = document.getElementById('tracks-container');
    poolTracks.forEach((track, index) => {
        const album = state.albumsMap.get(track.albumId);
        const item = document.createElement('div');
        item.className = 'list-item';
        if (state.currentPlaylist.length > 0 && state.currentPlaylist[state.currentIndex]?.id === track.id) item.classList.add('active');
        item.innerHTML = `<div class="list-item-content"><div class="list-item-num">${index + 1}</div><div style="min-width: 0;"><div class="list-item-title">${track.title}</div><div class="list-item-artist">${album.artistName} • ${album.title}</div></div><div class="list-item-time">${formatTime(track.durationSeconds)}</div></div>`;
        attachTrackEvents(item, track, poolTracks, index);
        list.appendChild(item);
    });
    DOM.mainContent.insertAdjacentHTML('beforeend', getCorporateFooter());
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

export const renderTracks = (albumId) => {
    const album = state.albumsMap.get(albumId);
    if (!album) return navigateTo('');

    DOM.btnBack.disabled = false;
    DOM.btnBack.onclick = () => navigateTo(`#artist/${album.artistId}`);
    DOM.navContext.textContent = album.title;

    album.tracks.sort((a, b) => {
        const discA = a.discNumber || 1;
        const discB = b.discNumber || 1;
        if (discA !== discB) return discA - discB;
        if (a.trackNumber !== b.trackNumber && a.trackNumber > 0 && b.trackNumber > 0) return a.trackNumber - b.trackNumber;
        return a.title.localeCompare(b.title);
    });

    const totalSeconds = album.tracks.reduce((sum, t) => sum + t.durationSeconds, 0);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const timeString = hrs > 0 ? `${hrs} hr ${mins} min` : `${mins} min`;
    const totalAlbumPlays = album.tracks.reduce((sum, t) => sum + (t.playCount || 0), 0);
    const maxPlay = Math.max(...album.tracks.map(t => t.playCount || 0));
    
    const avgBitrate = album.tracks.length > 0 ? album.tracks[0].bitrate : 0;
    const extMatch = album.tracks.length > 0 ? album.tracks[0].filePath.match(/\.([a-zA-Z0-9]+)$/) : null;
    const extStr = extMatch ? extMatch[1].toUpperCase() : '';
    const badgeHtml = avgBitrate > 0 ? `<span class="album-badge">${extStr} • ${avgBitrate} kbps</span>` : '';

    const yearString = album.releaseYear > 0 ? `${album.releaseYear}` : '';
    const imgUrl = album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&v=${state.appSessionVersion}` : 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';

    DOM.mainContent.innerHTML = `
        <div class="fade-bg"></div>
        <div class="album-hero">
            <div class="cover-wrapper">
                <img src="${imgUrl}" style="width: 232px; height: 232px; object-fit: cover;">
                <button id="btn-edit-album" class="edit-trigger" title="Edit Album"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg></button>
            </div>
            <div class="album-info">
                <div class="album-type">Album</div>
                <div class="album-title">${album.title}</div>
                <div class="album-meta">
                    <strong>${album.artistName}</strong><span class="dot">•</span><span>${yearString}</span><span class="dot">•</span><span>${album.tracks.length} songs, ${timeString}</span>${badgeHtml}
                </div>
            </div>
        </div>
        <div class="action-bar">
            <button class="btn-main-play" id="view-play-btn"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>
            <button class="btn-icon-bar ${state.isShuffle ? 'active' : ''}" id="view-shuffle-btn" title="Shuffle"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"></path><path d="m18 2 4 4-4 4"></path><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"></path><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"></path><path d="m18 14 4 4-4 4"></path></svg></button>
            <button class="btn-icon-bar" id="view-stats-btn" title="Toggle Stats Bar"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg></button>
            <button class="btn-icon-bar" id="view-ps2-btn" title="PS2 Tower View"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg></button>
        </div>
        <div id="ps2-tower-container" class="hidden"></div>
        <div class="list-container" id="tracks-container"><div class="list-header"><div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div></div></div>
    `;

    document.getElementById('btn-edit-album').addEventListener('click', () => {
        DOM.editId.value = album.id;
        DOM.editType.value = 'album';
        DOM.editName.value = album.title;
        DOM.editName.dataset.oldName = album.title;
        DOM.editImage.value = album.coverPath || '';
        DOM.editModalTitle.textContent = 'Modifica Album';
        DOM.editModal.classList.remove('hidden');
    });

    document.getElementById('view-play-btn').addEventListener('click', () => { 
        state.currentPlaylist = album.tracks; 
        if(state.isShuffle) {
             state.shuffleHistory = [];
             import('./player.js').then(p => p.playTrack(Math.floor(Math.random() * album.tracks.length)));
        } else {
             import('./player.js').then(p => p.playTrack(0)); 
        }
    });

    const viewShuffleBtn = document.getElementById('view-shuffle-btn');
    const list = document.getElementById('tracks-container');
    const ps2Container = document.getElementById('ps2-tower-container');
    const btnStats = document.getElementById('view-stats-btn');
    const btnPs2 = document.getElementById('view-ps2-btn');

    viewShuffleBtn.addEventListener('click', () => {
        state.isShuffle = !state.isShuffle;
        viewShuffleBtn.classList.toggle('active', state.isShuffle);
        DOM.btnShuffle.classList.toggle('active', state.isShuffle);
        DOM.fpBtnShuffle.classList.toggle('active', state.isShuffle);
        
        state.currentPlaylist = album.tracks;
        if (state.isShuffle) {
            state.shuffleHistory = [];
            import('./player.js').then(p => p.playTrack(Math.floor(Math.random() * album.tracks.length)));
        } else {
            import('./player.js').then(p => p.playTrack(0));
        }
    });

    btnStats.addEventListener('click', (e) => {
        const isActive = btnStats.classList.toggle('active');
        if (isActive) {
            list.classList.add('show-stats');
            btnPs2.classList.remove('active');
            ps2Container.classList.add('hidden');
            list.classList.remove('hidden');
        } else {
            list.classList.remove('show-stats');
        }
    });

    btnPs2.addEventListener('click', (e) => {
        const isActive = btnPs2.classList.toggle('active');
        if (isActive) {
            list.classList.add('hidden');
            ps2Container.classList.remove('hidden');
            btnStats.classList.remove('active');
            list.classList.remove('show-stats');
        } else {
            list.classList.remove('hidden');
            ps2Container.classList.add('hidden');
        }
    });

    const hasMultipleDiscs = album.tracks.some(t => (t.discNumber || 1) > 1);
    let currentDisc = 0;

    const ps2Grid = document.createElement('div');
    ps2Grid.className = 'ps2-grid';

    album.tracks.forEach((track, index) => {
        const trackDisc = track.discNumber || 1;
        if (hasMultipleDiscs && trackDisc !== currentDisc) {
            const discHeader = document.createElement('div');
            discHeader.style.gridColumn = '1 / -1';
            discHeader.style.padding = '16px 16px 8px 16px';
            discHeader.style.color = 'var(--text-primary)';
            discHeader.style.fontWeight = '700';
            discHeader.style.fontSize = '14px';
            discHeader.style.letterSpacing = '2px';
            discHeader.style.display = 'flex';
            discHeader.style.alignItems = 'center';
            discHeader.style.gap = '8px';
            discHeader.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="2"></circle></svg> DISC ${trackDisc}`;
            list.appendChild(discHeader);
            currentDisc = trackDisc;
        }

        const pct = totalAlbumPlays > 0 ? ((track.playCount || 0) / totalAlbumPlays) * 100 : 0;
        const item = document.createElement('div');
        item.className = 'list-item';
        if (state.currentPlaylist.length > 0 && state.currentPlaylist[state.currentIndex]?.id === track.id) item.classList.add('active');
        const trackNum = track.trackNumber > 0 ? track.trackNumber : (index + 1);
        
        const statBar = document.createElement('div');
        statBar.className = 'stat-bar';
        statBar.style.setProperty('--stat-w', `${pct}%`);
        item.appendChild(statBar);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'list-item-content';
        contentDiv.innerHTML = `<div class="list-item-num">${trackNum}</div><div style="min-width: 0;"><div class="list-item-title">${track.title}</div><div class="list-item-artist">${album.artistName}</div></div><div class="list-item-time">${formatTime(track.durationSeconds)}</div>`;
        item.appendChild(contentDiv);

        attachTrackEvents(item, track, album.tracks, index);
        list.appendChild(item);

        const ps2Pct = maxPlay > 0 ? ((track.playCount || 0) / maxPlay) * 100 : 10;
        const finalPs2Height = Math.max(10, ps2Pct);
        const tower = document.createElement('div');
        tower.className = 'ps2-tower';
        tower.style.setProperty('--tower-h', finalPs2Height);
        tower.innerHTML = `
            <div class="ps2-face ps2-front"></div>
            <div class="ps2-face ps2-right"></div>
            <div class="ps2-face ps2-top">${trackNum}</div>
            <div class="ps2-tooltip">${track.title}<br>${track.playCount || 0} plays</div>
        `;
        tower.addEventListener('click', () => {
            state.shuffleHistory = [];
            state.currentPlaylist = [...album.tracks];
            import('./player.js').then(p => p.playTrack(index));
        });
        ps2Grid.appendChild(tower);
    });

    ps2Container.appendChild(ps2Grid);
    DOM.mainContent.insertAdjacentHTML('beforeend', getCorporateFooter());
};