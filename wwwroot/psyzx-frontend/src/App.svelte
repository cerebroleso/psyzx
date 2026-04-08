<script>
    import { onMount } from 'svelte';
    import { fade, scale } from 'svelte/transition';
    import Sidebar from './lib/Sidebar.svelte';
    import Topbar from './lib/Topbar.svelte';
    import Player from './lib/Player.svelte';
    import FullPlayer from './lib/FullPlayer.svelte';
    import RightSidebar from './lib/RightSidebar.svelte';
    import Footer from './lib/Footer.svelte';
    import InitialLoader from './lib/InitialLoader.svelte';
    
    import Library from './lib/views/Library.svelte';
    import Artist from './lib/views/Artist.svelte';
    import Album from './lib/views/Album.svelte';
    import Settings from './lib/views/Settings.svelte';
    import TopPlayed from './lib/views/TopPlayed.svelte';
    import Search from './lib/views/Search.svelte';
    import ThePool from './lib/views/ThePool.svelte';
    import Offline from './lib/views/Offline.svelte';
    import Downloader from './lib/views/Downloader.svelte';
    import Account from './lib/views/Account.svelte';
    import Playlists from './lib/views/Playlists.svelte';
    import Playlist from './lib/views/Playlist.svelte';
    
    import { api } from './lib/api.js';
    import { allTracks, artistsMap, albumsMap, accentColor, isGlobalColorActive, isMaxGlassActive } from './store.js';
    
    let currentHash = '';
    let isMobileSidebarOpen = false;
    let isScrolled = false;
    let isLoading = true;
    let isFirstLoad = false;
    let isFullPlayerOpen = false;
    let apiError = null;
    
    let requiresLogin = false;
    let isRegisterMode = false;
    let loginUsername = '';
    let loginPassword = '';
    let loginErrorMsg = '';
    let isLoggingIn = false;

    $: navContextTitle = currentHash.startsWith('#album/') ? 'Album' 
                       : currentHash.startsWith('#artist/') ? 'Artist'
                       : currentHash.startsWith('#search/') ? 'Search'
                       : currentHash.startsWith('#playlist/') ? 'Playlist'
                       : currentHash === '#playlists' ? 'Playlists'
                       : currentHash === '#account' ? 'My Account'
                       : currentHash === '#settings' ? 'Settings' 
                       : currentHash === '#top' ? 'Top Played'
                       : currentHash === '#all' ? 'The Pool'
                       : currentHash === '#offline' ? 'Available Offline'
                       : currentHash === '#downloader' ? 'Downloader'
                       : 'Library';

    const localDB = {
        init() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('PsyZxStorage', 1);
                request.onupgradeneeded = (e) => e.target.result.createObjectStore('cache');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        },
        async set(key, val) {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('cache', 'readwrite');
                tx.objectStore('cache').put(val, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        },
        async get(key) {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('cache', 'readonly');
                const req = tx.objectStore('cache').get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
    };

    const buildLibrary = (data, statsData) => {
        const statsMap = new Map();
        if (statsData) {
            if (Array.isArray(statsData)) {
                statsData.forEach(s => statsMap.set(s.trackId || s.id, s.playCount || s.plays || 0));
            } else if (typeof statsData === 'object') {
                Object.entries(statsData).forEach(([k, v]) => statsMap.set(parseInt(k), typeof v === 'number' ? v : (v.playCount || v.plays || 0)));
            }
        }

        const newArtists = new Map();
        const newAlbums = new Map();

        data.forEach(track => {
            if (!track) return;
            track.playCount = statsMap.get(track.id) || track.playCount || 0;
            
            const album = track.album || { id: 9999, title: 'Unknown Album', coverPath: '' };
            const artist = album.artist || { id: 9999, name: 'Unknown Artist', imagePath: '' };
            
            if (!newArtists.has(artist.id)) newArtists.set(artist.id, { id: artist.id, name: artist.name, imagePath: artist.imagePath, albums: new Set() });
            newArtists.get(artist.id).albums.add(album.id);
            
            if (!newAlbums.has(album.id)) newAlbums.set(album.id, { id: album.id, title: album.title, coverPath: album.coverPath, releaseYear: album.releaseYear, playCount: album.playCount || 0, artistId: artist.id, artistName: artist.name, tracks: [] });
            
            const currentAlbum = newAlbums.get(album.id);
            if (!currentAlbum.tracks.some(t => t.id === track.id)) {
                currentAlbum.tracks.push(track);
                currentAlbum.playCount += track.playCount;
            }
        });

        allTracks.set(data);
        artistsMap.set(newArtists);
        albumsMap.set(newAlbums);
    };

    

    let bootProgress = 0;
    let bootStatus = "Waking up...";

    const bootEngine = async () => {
        isLoading = true;
        isFirstLoad = !sessionStorage.getItem('psyzx_booted');

        // Trickle: Updates bootProgress directly
        const trickle = setInterval(() => {
            if (bootProgress < 95) bootProgress += 0.2;
        }, 100);

        // Step 1
        bootStatus = "Verifying Identity...";
        const isAuth = await api.checkAuth();
        if (!isAuth) { 
            clearInterval(trickle);
            requiresLogin = true; 
            isLoading = false; 
            return; 
        }
        bootProgress = 25; // Updated from targetProgress

        // --- NEW: Auto-Create Favorites ---
        try {
            bootStatus = "Checking core playlists...";
            const playlists = await api.getPlaylists();
            if (!playlists.some(p => p.name === 'Favorites')) {
                await api.createPlaylist('Favorites');
            }
        } catch (e) { console.warn("Could not check favorites", e); }
        // ----------------------------------

        bootProgress = 35;

        try {
            // Step 2
            bootStatus = "Checking local storage...";
            const cachedLocal = await localDB.get('psyzx_library_cache');
            if (cachedLocal?.length > 0) {
                buildLibrary(cachedLocal, null);
                bootProgress = 45; // Updated from targetProgress
            }

            // Step 3
            bootStatus = "Syncing tracks from server...";
            let data = await api.getTracks();
            bootProgress = 85; // Updated from targetProgress

            if (data?.length > 0) {
                bootStatus = "Optimizing library...";
                localDB.set('psyzx_library_cache', data);
                bootProgress = 95; // Updated from targetProgress
                
                let statsData = null;
                try { statsData = await api.getStats(); } catch(e) {}
                buildLibrary(data, statsData);
            }
        } catch (e) {
            console.error(e);
        } finally {
            clearInterval(trickle);
            bootProgress = 100; // Updated from targetProgress
            bootStatus = "Ready.";
            setTimeout(() => {
                isLoading = false;
                sessionStorage.setItem('psyzx_booted', 'true');
            }, 800);
        }
    };

    const handleRefresh = async () => {
        isLoading = true;
        isFirstLoad = true; // Forces the nice full-screen loader to show up
        bootProgress = 10;
        bootStatus = "Commanding C# to scan /Music...";
        
        try {
            // 1. Tell backend to rescan files and update SQL
            await api.scanLibrary();
            bootProgress = 50;
            
            // 2. Fetch the newly updated database
            bootStatus = "Downloading fresh tracks...";
            let data = await api.getTracks();
            bootProgress = 80;
            
            // 3. Update the UI and Local Cache
            if (data?.length > 0) {
                bootStatus = "Rebuilding Library...";
                await localDB.set('psyzx_library_cache', data);
                
                let statsData = null;
                try { statsData = await api.getStats(); } catch(e) {}
                
                buildLibrary(data, statsData);
            }
        } catch (error) {
            console.error("Refresh failed:", error);
            apiError = "Library Sync Failed (Server Offline?)";
            setTimeout(() => apiError = null, 4000);
        } finally {
            bootProgress = 100;
            bootStatus = "Done.";
            setTimeout(() => {
                isLoading = false;
                isFirstLoad = false;
            }, 600);
        }
    };

    let showDeadlockWarning = false;
    
    onMount(() => {
        currentHash = window.location.hash;
        const handleHashChange = () => { 
            currentHash = window.location.hash; 
            isMobileSidebarOpen = false; 
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        window.addEventListener('hashchange', handleHashChange);
        bootEngine();

        const triggerWarning = () => {
            showDeadlockWarning = true;
        };

        window.addEventListener('ios-hardware-deadlock', triggerWarning);

        return () => {
            window.removeEventListener('hashchange', handleHashChange);
            window.removeEventListener('ios-hardware-deadlock', triggerWarning);
        };
    });

    if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => {
            console.log('SW Registered!', reg);
            // If the SW updated, this makes it take control immediately
            reg.onupdatefound = () => {
                const newWorker = reg.installing;
                newWorker.onstatechange = () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        location.reload(); 
                    }
                };
            };
        })
        .catch(err => console.error('SW Registration Failed', err));
}

    const handleScroll = (e) => { isScrolled = e.target.scrollTop > 50; };

    const executeAuth = async () => {
        if (!loginUsername || !loginPassword) {
            loginErrorMsg = "Fill all fields.";
            return;
        }
        
        isLoggingIn = true;
        loginErrorMsg = '';
        
        const credentials = { username: loginUsername, password: loginPassword };

        if (isRegisterMode) {
            const res = await api.register(credentials);
            if (res.ok) {
                isRegisterMode = false;
                await executeAuth(); 
            } else {
                loginErrorMsg = "Username already taken or server error.";
                isLoggingIn = false;
            }
        } else {
            const res = await api.login(credentials);
            if (res && res.ok) {
                requiresLogin = false;
                isLoading = true;
                bootEngine();
            } else {
                loginErrorMsg = "Invalid credentials. Retry.";
                isLoggingIn = false;
            }
        }
    };
</script>

{#if isLoading}
    {#if isFirstLoad}
        <InitialLoader progress={bootProgress} status={bootStatus} />
    {:else}
        <div id="loader-overlay" class="active" out:fade={{duration: 300}}>
            <div class="ios-spinner">
                {#each Array(12) as _, i}
                    <div style="transform: rotate({i * 30}deg); animation-delay: {-(1.1 - (i * 0.083))}s;"></div>
                {/each}
            </div>
        </div>
    {/if}
{/if}

{#if requiresLogin}
    <div class="auth-overlay" in:fade={{duration: 300}}>
        <div class="auth-card">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <h2>{isRegisterMode ? 'Create Account' : 'Access Required'}</h2>
            
            <form on:submit|preventDefault={executeAuth} class="auth-form">
                <input type="text" bind:value={loginUsername} placeholder="Username" required disabled={isLoggingIn} autocomplete="username">
                <input type="password" bind:value={loginPassword} placeholder="Password" required disabled={isLoggingIn} autocomplete={isRegisterMode ? "new-password" : "current-password"}>
                
                {#if loginErrorMsg}
                    <div class="auth-error">{loginErrorMsg}</div>
                {/if}
                
                <button type="submit" class="btn-auth" disabled={isLoggingIn}>
                    {#if isLoggingIn}
                        Working...
                    {:else}
                        {isRegisterMode ? 'Sign Up' : 'Enter'}
                    {/if}
                </button>
            </form>

            <button class="btn-toggle-auth" on:click={() => { isRegisterMode = !isRegisterMode; loginErrorMsg = ''; }} disabled={isLoggingIn}>
                {isRegisterMode ? 'Already have an account? Login' : 'No account? Register here'}
            </button>
        </div>
    </div>
{/if}

{#if apiError && !requiresLogin}
    <div id="toast-msg" class="show" style="background: #ef4444;">{apiError}</div>
{/if}

<div class="global-dynamic-bg" style="background-color: {$isGlobalColorActive ? $accentColor : '#1a0524'};"></div>
<div class="global-gradient-overlay"></div>

{#if !requiresLogin && !isLoading}
    <div id="app-layout" style="position: relative; z-index: 1;">
        <div class="app-row" class:max-glass-layout={$isMaxGlassActive}>
            <Sidebar bind:isMobileOpen={isMobileSidebarOpen} {currentHash} />

            <main id="main-view" on:scroll={handleScroll}>
                <Topbar 
                    {isScrolled} 
                    navContext={navContextTitle} 
                    currentHash={currentHash} 
                    on:toggleSidebar={() => isMobileSidebarOpen = !isMobileSidebarOpen} 
                    on:refresh={handleRefresh} 
                />                
                <div id="main-content" style="flex: 1; display: grid;">
                    {#key currentHash}
                    <div in:fade={{duration: 250, delay: 100}} out:fade={{duration: 100}} style="grid-area: 1 / 1; display: flex; flex-direction: column; min-height: 100%;">
                        
                        <div style="flex-grow: 1;">
                            {#if currentHash === '' || currentHash === '#' || currentHash === '#/'}
                                <Library />
                            {:else if currentHash.startsWith('#artist/')}
                                <Artist artistId={currentHash.split('/')[1]} />
                            {:else if currentHash.startsWith('#album/')}
                                <Album albumId={currentHash.split('/')[1]} />
                            {:else if currentHash.startsWith('#search/')}
                                <Search query={decodeURIComponent(currentHash.substring(8))} />
                            {:else if currentHash === '#playlists'}
                                <Playlists />
                            {:else if currentHash.startsWith('#playlist/')} 
                                <Playlist playlistId={currentHash.split('/')[1]} />
                            {:else if currentHash === '#account'}
                                <Account />
                            {:else if currentHash === '#top'}
                                <TopPlayed />
                            {:else if currentHash === '#all'}
                                <ThePool />
                            {:else if currentHash === '#offline'}
                                <Offline />
                            {:else if currentHash === '#downloader'}
                                <Downloader />
                            {:else if currentHash === '#settings'}
                                <Settings />
                            {:else}
                                <div style="padding: 24px; color: var(--text-secondary);">Route not found.</div>
                            {/if}
                        </div>

                        <Footer />
                        
                    </div>
                    {/key}
                </div>
            </main>

            <aside id="right-sidebar">
                <RightSidebar />
            </aside>
        </div>

        <Player on:toggleFull={() => isFullPlayerOpen = !isFullPlayerOpen} />
    </div>

    <FullPlayer isOpen={isFullPlayerOpen} on:close={() => isFullPlayerOpen = false} />
{/if}

{#if showDeadlockWarning}
    <div 
        class="system-modal-backdrop" 
        transition:fade={{duration: 200}} 
        style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); z-index: 999999; display: flex; align-items: center; justify-content: center; padding: 24px;"
    >
        <div 
            class="system-modal-card" 
            transition:scale={{start: 0.9, duration: 250, opacity: 0}}
            style="background: #1c1c1e; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 24px; text-align: center; max-width: 320px; box-shadow: 0 25px 50px rgba(0,0,0,0.5);"
        >
            <div style="background: rgba(255,59,48,0.15); width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff3b30" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
            </div>
            
            <h3 style="margin: 0 0 8px; font-size: 18px; color: white;">Audio System Locked</h3>
            
            <p style="margin: 0 0 16px; font-size: 14px; color: rgba(255,255,255,0.7); line-height: 1.4;">
                Apple's iOS has locked your device's audio hardware. This is a known WebKit bug that prevents playback.
            </p>
            <p style="margin: 0 0 24px; font-size: 15px; color: white; font-weight: 600;">
                Please reboot your iPhone to clear the hardware cache.
            </p>
            
            <button 
                on:click={() => showDeadlockWarning = false}
                style="background: white; color: black; border: none; border-radius: 12px; padding: 12px 24px; font-weight: 600; font-size: 16px; width: 100%; cursor: pointer;"
            >
                Dismiss
            </button>
        </div>
    </div>
{/if}

<style>
    :global(body), :global(html) {
        background-color: #050505 !important;
        margin: 0; padding: 0;
        overflow: hidden;
    }

    :global(#app-layout) {
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
        background: transparent !important;
    }

    .app-row {
        display: flex;
        flex-direction: row;
        flex: 1;
        width: 100%;
        height: calc(100vh - 80px);
        overflow: hidden;
        position: relative;
        transition: padding 0.3s ease, gap 0.3s ease;
    }

    .app-row.max-glass-layout {
        padding: 16px 16px 0 16px;
        gap: 16px;
        align-items: flex-start;
    }

    :global(.app-row > aside) {
        background: rgba(0, 0, 0, 0.02) !important;
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border-right: 1px solid rgba(255,255,255,0.05);
    }

    :global(.app-row.max-glass-layout > aside), 
    :global(.app-row.max-glass-layout > main#main-view) {
        border-radius: 24px !important;
        background: rgba(255, 255, 255, 0.05) !important;
        backdrop-filter: blur(32px) saturate(120%) !important;
        -webkit-backdrop-filter: blur(32px) saturate(120%) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        box-shadow: 0 16px 40px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1) !important;
        overflow-x: hidden;
        height: 100% !important;
        will-change: transform;
    }

    @supports (-moz-appearance:none) {
        :global(.app-row.max-glass-layout > aside), :global(.app-row.max-glass-layout > main#main-view) {
            backdrop-filter: blur(16px) !important;
            background: rgba(255, 255, 255, 0.08) !important;
        }
    }

    :global(main#main-view) { flex: 1; overflow-y: auto; position: relative; }
    :global(#topbar) { 
        position: sticky !important; 
        top: 0 !important; 
        z-index: 10000 !important; 
        transition: background 0.3s ease, border-bottom 0.3s ease, backdrop-filter 0.3s ease, box-shadow 0.3s ease !important;
    }

    :global(#topbar.scrolled) {
        background: rgba(5, 5, 5, 0.40) !important;
        backdrop-filter: blur(32px) saturate(150%) !important;
        -webkit-backdrop-filter: blur(32px) saturate(150%) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important;
    }

    :global(#right-sidebar) {
        width: 420px !important;
        min-width: 420px !important;
        flex-shrink: 0 !important;
        border-left: 1px solid rgba(255,255,255,0.05);
    }

    /* SFONDI DINAMICI E OVERLAY */
    .global-dynamic-bg {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        z-index: -2; pointer-events: none;
        -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%);
        mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 100%);
        opacity: 0.35;
        transition: background-color 0.8s ease;
    }

    .global-gradient-overlay {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: linear-gradient(to bottom, transparent 0%, #050505 100%);
        z-index: -1; pointer-events: none;
    }

    /* OVERLAY SCURO E BLURRATO PER IL LOGIN */
    .auth-overlay {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.6); 
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        z-index: 999999;
        perspective: 1000px;
    }

    /* CARD LOGIN ULTRA-GLASS */
    .auth-card {
        background: rgba(255, 255, 255, 0.03);
        backdrop-filter: blur(40px) saturate(150%);
        -webkit-backdrop-filter: blur(40px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-top: 1px solid rgba(255, 255, 255, 0.25); /* Glossy top edge */
        padding: 48px 40px; 
        border-radius: 28px; 
        text-align: center; 
        width: 90%;
        max-width: 420px;
        box-shadow: 
            0 32px 64px rgba(0, 0, 0, 0.5), 
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        transform: translateY(0);
        animation: cardFloatUp 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
    }

    @keyframes cardFloatUp {
        0% { opacity: 0; transform: translateY(30px) scale(0.95); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
    }

    .auth-card h2 { 
        margin: 0 0 32px 0; 
        font-size: 28px; 
        color: white; 
        font-weight: 800;
        letter-spacing: -1px;
    }

    .auth-form { 
        display: flex; 
        flex-direction: column; 
        gap: 16px; 
    }

    /* INPUT CAMPI INCASSATI E LUMINOSI */
    .auth-form input {
        width: 100%; 
        padding: 16px 20px; 
        background: rgba(0, 0, 0, 0.3); 
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.05); 
        border-radius: 16px; 
        font-size: 15px;
        box-sizing: border-box; 
        outline: none; 
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
    }

    .auth-form input::placeholder {
        color: rgba(255, 255, 255, 0.3);
    }

    .auth-form input:focus { 
        border-color: var(--accent-color); 
        background: rgba(0, 0, 0, 0.5);
        box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1), inset 0 2px 4px rgba(0,0,0,0.2); 
    }
    
    .auth-form input:disabled { 
        opacity: 0.5; 
        cursor: not-allowed; 
    }

    .auth-error { 
        color: #ef4444; 
        font-size: 13px; 
        font-weight: 700; 
        margin-top: -4px; 
        background: rgba(239, 68, 68, 0.1);
        padding: 10px;
        border-radius: 10px;
        border: 1px solid rgba(239, 68, 68, 0.2);
    }

    /* BOTTONE CALL TO ACTION */
    .btn-auth {
        background: var(--accent-color); 
        color: black; 
        border: none; 
        padding: 16px;
        font-size: 16px; 
        font-weight: 800; 
        border-radius: 16px; 
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
        width: 100%; 
        margin-top: 8px;
    }

    .btn-auth:hover:not(:disabled) { 
        transform: translateY(-2px); 
        box-shadow: 0 8px 24px rgba(255, 255, 255, 0.2);
        filter: brightness(1.15);
    }
    
    .btn-auth:active:not(:disabled) {
        transform: translateY(1px);
        box-shadow: 0 2px 8px rgba(255, 255, 255, 0.1);
    }

    .btn-auth:disabled { 
        opacity: 0.7; 
        cursor: wait; 
        filter: grayscale(0.5);
    }

    /* BOTTONE TOGGLE SECONDARIO */
    .btn-toggle-auth {
        background: none; 
        border: none; 
        color: rgba(255, 255, 255, 0.4);
        margin-top: 24px; 
        cursor: pointer; 
        font-size: 14px; 
        font-weight: 600;
        transition: all 0.2s;
    }

    .btn-toggle-auth:hover { 
        color: white; 
        text-shadow: 0 0 12px rgba(255,255,255,0.4);
    }

    #loader-overlay {
        position: fixed; 
        inset: 0; 
        background: rgba(5, 5, 5, 0.8);
        backdrop-filter: blur(20px); 
        -webkit-backdrop-filter: blur(20px);
        display: flex; 
        align-items: center; 
        justify-content: center; 
        z-index: 999999;
    }

    .ios-spinner {
        position: relative; 
        width: 36px; 
        height: 36px;
        display: inline-block;
    }

    .ios-spinner div {
        position: absolute; 
        left: 46%; 
        top: 10%;
        width: 8%; 
        height: 26%;
        background: rgba(255, 255, 255, 0.9);
        border-radius: 50px; 
        opacity: 0;
        animation: ios-fade 1s linear infinite;
        transform-origin: 50% 150%;
        will-change: opacity;
    }

    @keyframes ios-fade {
        from { opacity: 1; }
        to { opacity: 0.15; }
    }

    /* MEDIA QUERIES (FIX MOBILE ANTI-GLITCH) */
    @media (max-width: 768px) {
        .app-row.max-glass-layout { padding: 12px 12px 0 12px; gap: 12px; }

        :global(.app-row > aside:first-child) {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            height: 100dvh !important;
            z-index: 100005 !important;
            padding-bottom: 140px !important;
        }

        :global(.app-row.max-glass-layout > aside:first-child) {
            top: 12px !important;
            left: 12px !important;
            height: calc(100dvh - 24px) !important;
            width: calc(100vw - 24px) !important;
            border-radius: 20px !important;
            
            pointer-events: none;
            transition: pointer-events 0s linear 0.3s; 
        }

        :global(.app-row.max-glass-layout > aside:first-child.open) {
            pointer-events: auto !important;
            transition: pointer-events 0s linear 0s;
        }

        :global(.app-row.max-glass-layout > main#main-view) {
            border-radius: 20px !important;
        }
    }

    :global(.max-glass-layout) {
        --surface-color: rgba(255, 255, 255, 0.05) !important;
    }

    :global(.max-glass-layout .card),
    :global(.max-glass-layout .album-card), 
    :global(.max-glass-layout .artist-card), 
    :global(.max-glass-layout .playlist-card), 
    :global(.max-glass-layout .grid-item) {
        background: var(--surface-color) !important;
        backdrop-filter: blur(24px) saturate(120%) !important;
        -webkit-backdrop-filter: blur(24px) saturate(120%) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 12px !important;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2), inset 1px 1px 0 rgba(255,255,255,0.1) !important;
        overflow: hidden;
        transition: transform 0.3s ease, background-color 0.3s ease;
    }

    :global(.max-glass-layout .card:hover) {
        background: rgba(255, 255, 255, 0.1) !important;
    }

    :global(body.modal-open #app-layout) {
        transform: scale(var(--modal-scale, 0.93)) translateY(10px) !important;
        border-radius: 32px !important;
        overflow: hidden !important;
        pointer-events: none !important; /* Prevents clicking background while player is open */
        filter: brightness(0.6) !important;
        transition: transform 0.8s cubic-bezier(0.32, 0.72, 0, 1), 
                    filter 0.8s ease, 
                    border-radius 0.8s ease !important;
    }

    :global(body) {
        background-color: #000 !important; /* Background must be black for the 'gap' to look right */
    }
</style>