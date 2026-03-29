export const state = {
    artistsMap: new Map(),
    albumsMap: new Map(),
    allTracks: [],
    currentPlaylist: [],
    currentIndex: -1,
    queueOffset: 1,
    isShuffle: false,
    isRepeat: false,
    shuffleHistory: [],
    appSessionVersion: Date.now(),
    lastFetchTime: 0,
    queueInterval: null
};