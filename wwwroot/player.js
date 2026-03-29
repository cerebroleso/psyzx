import { DOM } from './dom.js';
import { state } from './state.js';
import { formatTime, updateThemeColor, showToast } from './utils.js';
import { renderTracks, renderTopPlayed, renderAllTracks, renderSearch, navigateTo } from './views.js';

export const updatePositionState = () => {
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
        const duration = DOM.audioEl.duration;
        const position = DOM.audioEl.currentTime;
        const playbackRate = DOM.audioEl.playbackRate || 1;

        if (duration > 0 && !isNaN(duration) && isFinite(duration) && position >= 0 && position <= duration) {
            try {
                navigator.mediaSession.setPositionState({
                    duration: duration,
                    playbackRate: playbackRate,
                    position: position
                });
            } catch (error) {}
        }
    }
};

export const queueTrack = (track) => {
    if (state.currentPlaylist.length === 0) {
        state.currentPlaylist.push(track);
        playTrack(0);
    } else {
        state.currentPlaylist.splice(state.currentIndex + state.queueOffset, 0, track);
        state.queueOffset++;
        showToast(`➕ In Coda: ${track.title}`);
    }
};

export const attachTrackEvents = (item, track, sourcePlaylist, index) => {
    let startX = 0;
    let isSwiping = false;

    item.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        isSwiping = false;
    }, {passive: true});

    item.addEventListener('touchmove', e => {
        const diffX = startX - e.touches[0].clientX;
        if (Math.abs(diffX) > 10) isSwiping = true;
        if (diffX > 0 && diffX < 80) item.style.transform = `translateX(-${diffX}px)`;
    }, {passive: true});

    item.addEventListener('touchend', e => {
        const endX = e.changedTouches[0].clientX;
        item.style.transform = ''; 
        item.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
        setTimeout(() => item.style.transition = '', 200);
        if (startX - endX > 60) queueTrack(track);
        setTimeout(() => isSwiping = false, 50);
    });

    item.addEventListener('click', () => {
        if (isSwiping) return;
        if (state.currentPlaylist !== sourcePlaylist) {
            state.shuffleHistory = [];
        }
        state.currentPlaylist = [...sourcePlaylist];
        playTrack(index);
    });
};

export const updatePlayerUI = (track, album) => {
    if (!track || !album) return;
    DOM.npTitle.textContent = track.title;
    DOM.npArtist.textContent = album.artistName;
    DOM.fpBigTitle.textContent = track.title;
    DOM.fpBigArtist.textContent = album.artistName;

    const imgUrl = album.coverPath ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&v=${state.appSessionVersion}` : '';
    const defImg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
    
    DOM.npCover.src = imgUrl || defImg;
    DOM.fpBigCover.src = imgUrl || defImg;
    updateThemeColor(imgUrl);

    DOM.iconPlay.classList.add('hidden');
    DOM.iconPause.classList.remove('hidden');
    DOM.fpIconPlay.classList.add('hidden');
    DOM.fpIconPause.classList.remove('hidden');
    
    const extMatch = track.filePath.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toUpperCase() : 'UNK';
    if(DOM.fileBadge) DOM.fileBadge.textContent = track.bitrate > 0 ? `${ext} • ${track.bitrate} kbps` : ext;
    
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: album.artistName,
            album: album.title,
            artwork: imgUrl ? [{ src: window.location.origin + imgUrl, sizes: '512x512', type: 'image/jpeg' }] : []
        });
        
        navigator.mediaSession.setActionHandler('play', () => DOM.audioEl.play());
        navigator.mediaSession.setActionHandler('pause', () => DOM.audioEl.pause());
        navigator.mediaSession.setActionHandler('previoustrack', playPrev);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
        
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime) {
                DOM.audioEl.currentTime = details.seekTime;
                updatePositionState();
            }
        });
    }
};

export const saveState = () => {
    if (state.currentPlaylist.length > 0 && state.currentIndex >= 0) {
        localStorage.setItem('psyzx_playlist', JSON.stringify(state.currentPlaylist));
        localStorage.setItem('psyzx_index', state.currentIndex);
    }
};

export const loadState = () => {
    const savedPlaylist = localStorage.getItem('psyzx_playlist');
    const savedIndex = localStorage.getItem('psyzx_index');
    const savedTime = localStorage.getItem('psyzx_time');
    if (savedPlaylist && savedIndex) {
        state.currentPlaylist = JSON.parse(savedPlaylist);
        state.currentIndex = parseInt(savedIndex);
        const track = state.currentPlaylist[state.currentIndex];
        if (track) {
            const album = state.albumsMap.get(track.albumId);
            updatePlayerUI(track, album);
            DOM.audioEl.src = `/api/Tracks/stream/${track.id}`;
            
            DOM.iconPause.classList.add('hidden');
            DOM.iconPlay.classList.remove('hidden');
            DOM.fpIconPause.classList.add('hidden');
            DOM.fpIconPlay.classList.remove('hidden');
            
            if (savedTime) {
                DOM.audioEl.currentTime = parseFloat(savedTime);
                DOM.timeCurrentEl.textContent = formatTime(parseFloat(savedTime));
                DOM.fpTimeCurrent.textContent = formatTime(parseFloat(savedTime));
                DOM.audioEl.addEventListener('loadedmetadata', () => {
                    DOM.audioEl.currentTime = parseFloat(savedTime);
                    updatePositionState();
                }, { once: true });
            }
        }
    }
};

export const playTrack = (index) => {
    if (state.currentPlaylist.length === 0) return;
    if (index < 0) index = state.currentPlaylist.length - 1;
    if (index >= state.currentPlaylist.length) index = 0;
    
    state.currentIndex = index;
    state.queueOffset = 1;
    
    const track = state.currentPlaylist[state.currentIndex];
    const album = state.albumsMap.get(track.albumId);

    DOM.audioEl.pause();
    const streamUrl = `/api/Tracks/stream/${track.id}`;
    
    const startTime = performance.now();
    DOM.audioEl.src = streamUrl;

    DOM.audioEl.play().then(() => {
        state.lastFetchTime = Math.round(performance.now() - startTime);
        updatePlayerUI(track, album);
        saveState();
        updatePositionState();
    }).catch(err => {});

    const hash = window.location.hash;
    if (hash.startsWith('#album/')) renderTracks(track.albumId);
    else if (hash === '#top') renderTopPlayed();
    else if (hash === '#all') renderAllTracks();
    else if (hash.startsWith('#search/')) renderSearch(decodeURIComponent(hash.split('/')[1]));
    else if (hash === '#lyrics') navigateTo('#lyrics');
};

export const togglePlay = () => {
    if (!DOM.audioEl.src && state.currentPlaylist.length > 0) {
        playTrack(state.currentIndex > -1 ? state.currentIndex : 0);
        return;
    }
    if (!DOM.audioEl.src) return;
    if (DOM.audioEl.paused) DOM.audioEl.play();
    else DOM.audioEl.pause();
};

export const playNext = () => {
    if (state.isShuffle && state.currentPlaylist.length > 1) {
        if (!state.shuffleHistory) state.shuffleHistory = [];
        state.shuffleHistory.push(state.currentIndex);
        
        let unplayed = Array.from({length: state.currentPlaylist.length}, (_, i) => i)
                            .filter(i => !state.shuffleHistory.includes(i));
                            
        if (unplayed.length === 0) {
            state.shuffleHistory = [];
            unplayed = Array.from({length: state.currentPlaylist.length}, (_, i) => i)
                            .filter(i => i !== state.currentIndex);
        }
        
        let newIndex = unplayed[Math.floor(Math.random() * unplayed.length)];
        playTrack(newIndex);
    } else {
        playTrack(state.currentIndex + 1);
    }
};

export const playPrev = () => {
    if (state.isShuffle && state.shuffleHistory && state.shuffleHistory.length > 0) {
        const prevIndex = state.shuffleHistory.pop();
        playTrack(prevIndex);
    } else {
        playTrack(state.currentIndex - 1);
    }
};

export const toggleShuffle = () => {
    state.isShuffle = !state.isShuffle;
    if (!state.isShuffle) state.shuffleHistory = [];
    DOM.btnShuffle.classList.toggle('active', state.isShuffle);
    DOM.fpBtnShuffle.classList.toggle('active', state.isShuffle);
};

export const toggleRepeat = () => {
    state.isRepeat = !state.isRepeat;
    DOM.btnRepeat.classList.toggle('active', state.isRepeat);
    DOM.fpBtnRepeat.classList.toggle('active', state.isRepeat);
};

export const setupPlayerEvents = () => {
    DOM.audioEl.addEventListener('play', () => {
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "playing";
        DOM.iconPlay.classList.add('hidden');
        DOM.iconPause.classList.remove('hidden');
        DOM.fpIconPlay.classList.add('hidden');
        DOM.fpIconPause.classList.remove('hidden');
        
        if (window.extractedColor) {
            document.documentElement.style.setProperty('--accent-color', window.extractedColor);
            document.documentElement.style.setProperty('--accent-dark', window.extractedDark);
        }
        
        updatePositionState();
    });

    DOM.audioEl.addEventListener('pause', () => {
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "paused";
        DOM.iconPause.classList.add('hidden');
        DOM.iconPlay.classList.remove('hidden');
        DOM.fpIconPause.classList.add('hidden');
        DOM.fpIconPlay.classList.remove('hidden');

        document.documentElement.style.setProperty('--accent-color', '#d946ef');
        document.documentElement.style.setProperty('--accent-dark', 'rgba(217, 70, 239, 0.2)');
    });

    DOM.audioEl.addEventListener('ended', () => {
        if (state.isRepeat) {
            DOM.audioEl.currentTime = 0;
            DOM.audioEl.play();
        } else {
            playNext();
        }
    });

    DOM.audioEl.addEventListener('timeupdate', () => {
        if (!DOM.audioEl.duration) return;
        const current = DOM.audioEl.currentTime;
        const total = DOM.audioEl.duration;
        DOM.timeCurrentEl.textContent = formatTime(current);
        DOM.fpTimeCurrent.textContent = formatTime(current);
        const percent = (current / total) * 100;
        DOM.progressBar.style.width = `${percent}%`;
        DOM.fpProgressBar.style.width = `${percent}%`;
        localStorage.setItem('psyzx_time', current);

        if (Math.floor(current) % 5 === 0) updatePositionState();

        if (window.location.hash === '#lyrics') {
            const lines = document.querySelectorAll('.lrc-line');
            let activeLine = null;
            lines.forEach(line => {
                if (current >= parseFloat(line.dataset.time)) activeLine = line;
            });
            if (activeLine && !activeLine.classList.contains('active')) {
                lines.forEach(l => l.classList.remove('active'));
                activeLine.classList.add('active');
                activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });

    DOM.audioEl.addEventListener('loadedmetadata', () => {
        DOM.timeTotalEl.textContent = formatTime(DOM.audioEl.duration);
        DOM.fpTimeTotal.textContent = formatTime(DOM.audioEl.duration);
        updatePositionState();
    });

    const seek = (e, container) => {
        if (!DOM.audioEl.duration) return;
        const rect = container.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        DOM.audioEl.currentTime = percent * DOM.audioEl.duration;
        updatePositionState();
    };
    DOM.progressContainer.addEventListener('click', (e) => seek(e, DOM.progressContainer));
    DOM.fpProgressContainer.addEventListener('click', (e) => seek(e, DOM.fpProgressContainer));

    DOM.btnPlay.addEventListener('click', togglePlay);
    DOM.btnNext.addEventListener('click', playNext);
    DOM.btnPrev.addEventListener('click', playPrev);
    DOM.fpBtnPlay.addEventListener('click', togglePlay);
    DOM.fpBtnNext.addEventListener('click', playNext);
    DOM.fpBtnPrev.addEventListener('click', playPrev);
    DOM.btnShuffle.addEventListener('click', toggleShuffle);
    DOM.fpBtnShuffle.addEventListener('click', toggleShuffle);
    DOM.btnRepeat.addEventListener('click', toggleRepeat);
    DOM.fpBtnRepeat.addEventListener('click', toggleRepeat);

    if(DOM.btnLyrics) {
        DOM.btnLyrics.addEventListener('click', () => { window.location.hash = '#lyrics'; });
    }

    if(DOM.btnDownload) {
        DOM.btnDownload.addEventListener('click', () => {
            if (state.currentIndex < 0) return;
            const track = state.currentPlaylist[state.currentIndex];
            const extMatch = track.filePath.match(/\.([a-zA-Z0-9]+)$/);
            const ext = extMatch ? extMatch[1] : 'mp3';
            const a = document.createElement('a');
            a.href = `/api/Tracks/stream/${track.id}`;
            a.download = `${track.title}.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    }
};