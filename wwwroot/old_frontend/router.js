import { DOM } from './dom.js';
import { state } from './state.js';
import { renderArtists, renderAlbums } from './view-library.js';
import { renderTracks } from './view-album.js';
import { renderTopPlayed, renderAllTracks, renderOfflineTracks } from './view-collections.js';
import { renderSearch, renderLyrics, renderDownloader, renderSettings } from './view-tools.js';

export const navigateTo = async (hash) => {
    if (DOM.sidebar.classList.contains('mobile-active')) DOM.sidebar.classList.remove('mobile-active');
    if (state.artistsMap.size === 0 && hash !== '#downloader' && hash !== '#settings') return;
    
    DOM.loaderOverlay.classList.add('active');
    await new Promise(r => setTimeout(r, 100));
    
    DOM.mainContent.innerHTML = '';
    DOM.mainView.scrollTop = 0;
    
    document.querySelectorAll('.side-nav a').forEach(el => el.classList.remove('active'));

    if (!hash || hash === '') { DOM.navHome.classList.add('active'); renderArtists(); }
    else if (hash === '#top') { if(DOM.navTop) DOM.navTop.classList.add('active'); renderTopPlayed(); }
    else if (hash === '#all') { if(DOM.navAll) DOM.navAll.classList.add('active'); renderAllTracks(); }
    else if (hash === '#downloader') { if(DOM.navDownloader) DOM.navDownloader.classList.add('active'); renderDownloader(); }
    else if (hash === '#offline') { if(DOM.navOffline) DOM.navOffline.classList.add('active'); await renderOfflineTracks(); }
    else if (hash === '#settings') { if(DOM.navSettings) DOM.navSettings.classList.add('active'); renderSettings(); }
    else if (hash === '#lyrics') { renderLyrics(); }
    else if (hash.startsWith('#search/')) renderSearch(decodeURIComponent(hash.split('/')[1]));
    else if (hash.startsWith('#artist/')) renderAlbums(parseInt(hash.split('/')[1]));
    else if (hash.startsWith('#album/')) renderTracks(parseInt(hash.split('/')[1]));

    DOM.loaderOverlay.classList.remove('active');
};