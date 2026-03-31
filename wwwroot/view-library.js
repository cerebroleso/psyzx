import { DOM } from './dom.js';
import { state } from './state.js';
import { navigateTo } from './router.js';
import { getCorporateFooter } from './utils.js';

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