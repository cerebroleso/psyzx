import { DOM } from './dom.js';
import { state } from './state.js';
import { formatTime, getCorporateFooter } from './utils.js';
import { attachTrackEvents, playTrack, playNext } from './player.js';
import { navigateTo } from './router.js';

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
        <div id="ps2-tower-container" style="display: none;"></div>
        <div class="list-container active-view" id="tracks-container"><div class="list-header"><div style="text-align:center;">#</div><div>Title</div><div style="text-align:right;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div></div></div>
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
            if (btnPs2.classList.contains('active')) {
                btnPs2.classList.remove('active');
                ps2Container.classList.remove('active-view');
                setTimeout(() => {
                    ps2Container.style.display = 'none';
                    list.style.display = 'flex';
                    void list.offsetWidth;
                    list.classList.add('active-view');
                    list.classList.add('show-stats');
                }, 400);
            } else {
                list.classList.add('show-stats');
            }
        } else {
            list.classList.remove('show-stats');
        }
    });

    btnPs2.addEventListener('click', (e) => {
        const isActive = btnPs2.classList.toggle('active');
        if (isActive) {
            list.classList.remove('active-view');
            setTimeout(() => {
                list.style.display = 'none';
                ps2Container.style.display = 'flex';
                void ps2Container.offsetWidth;
                ps2Container.classList.add('active-view');
                
                const towers = ps2Container.querySelectorAll('.ps2-tower');
                towers.forEach((tower, i) => {
                    tower.style.setProperty('--tower-h', 0);
                    tower.style.height = `0px`;
                    setTimeout(() => {
                        tower.style.setProperty('--tower-h', tower.dataset.targetHeight);
                        tower.style.height = `auto`;
                    }, 100 + (i * 40));
                });
            }, 400);
            btnStats.classList.remove('active');
            list.classList.remove('show-stats');
        } else {
            ps2Container.classList.remove('active-view');
            setTimeout(() => {
                ps2Container.style.display = 'none';
                list.style.display = 'flex';
                void list.offsetWidth;
                list.classList.add('active-view');
            }, 400);
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
        
        item.innerHTML = `
            <div class="swipe-bg"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div>
            <div class="stat-bar" style="--stat-w: ${pct}%; transition-delay: ${index * 0.04}s;"></div>
            <div class="list-item-content">
                <div class="list-item-num">${trackNum}</div>
                <div style="min-width: 0;">
                    <div class="list-item-title">${track.title}</div>
                    <div class="list-item-artist">${album.artistName}</div>
                </div>
                <div class="list-item-time">${formatTime(track.durationSeconds)}</div>
            </div>
        `;
        
        attachTrackEvents(item, track, album.tracks, index);
        list.appendChild(item);

        const ps2Pct = maxPlay > 0 ? ((track.playCount || 0) / maxPlay) * 150 + 10 : 10;
        const tower = document.createElement('div');
        tower.className = 'ps2-tower';
        tower.dataset.targetHeight = ps2Pct;
        tower.style.setProperty('--tower-h', 0);
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