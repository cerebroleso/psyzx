import { DOM } from './dom.js';
import { state } from './state.js';
import { formatTime, getCorporateFooter } from './utils.js';
import { attachTrackEvents, playTrack, playNext } from './player.js';
import { navigateTo } from './router.js';

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
        <div class="action-bar"><button class="btn-main-play" id="view-play-btn"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button></div>
        <div class="list-container active-view" id="tracks-container"><div class="list-header"><div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;">Plays</div></div></div>
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

    const list = document.getElementById('tracks-container');
    topTracks.forEach((track, index) => {
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
                    <div class="list-item-artist">${album.artistName}</div>
                </div>
                <div class="list-item-time">${track.playCount}</div>
            </div>
        `;
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
        <div class="list-container active-view" id="tracks-container"><div class="list-header"><div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;">Time</div></div></div>
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
        attachTrackEvents(item, track, poolTracks, index);
        list.appendChild(item);
    });
    DOM.mainContent.insertAdjacentHTML('beforeend', getCorporateFooter());
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
            const cachedIds = reqs.map(req => {
                try {
                    const urlObj = new URL(req.url);
                    const pathParts = urlObj.pathname.split('/');
                    return pathParts[pathParts.length - 1];
                } catch(e) {
                    return req.url.split('/').pop().split('?')[0];
                }
            });
            offlineTracks = state.allTracks.filter(t => cachedIds.includes(t.id.toString()));
        }
    } catch (e) {}

    offlineTracks.sort((a, b) => a.title.localeCompare(b.title));

    DOM.mainContent.innerHTML = `
        <div class="fade-bg"></div>
        <div class="album-hero">
            <div style="width:232px; height:232px; background: linear-gradient(135deg, #10b981, #000); border-radius:4px; display:flex; align-items:center; justify-content:center; box-shadow: 0 4px 60px rgba(0,0,0,0.5);">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path><path d="M12 15v6"></path><polyline points="9 18 12 21 15 18"></polyline></svg>
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
        <div class="list-container active-view" id="tracks-container"><div class="list-header"><div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;">Time</div></div></div>
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
            item.innerHTML = `
                <div class="swipe-bg"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>
                <div class="list-item-content">
                    <div class="list-item-num">${index + 1}</div>
                    <div style="min-width: 0;">
                        <div class="list-item-title">${track.title}</div>
                        <div class="list-item-artist">${album ? album.artistName : 'Unknown'} • ${album ? album.title : 'Unknown'}</div>
                    </div>
                    <div class="list-item-time">${formatTime(track.durationSeconds || 0)}</div>
                </div>
            `;
            attachTrackEvents(item, track, offlineTracks, index);
            list.appendChild(item);
        });
    } else {
        document.getElementById('tracks-container').innerHTML += `<div style="padding: 48px; text-align: center; color: var(--text-secondary);">No downloaded tracks found in cache.</div>`;
    }
    
    DOM.mainContent.insertAdjacentHTML('beforeend', getCorporateFooter());
};