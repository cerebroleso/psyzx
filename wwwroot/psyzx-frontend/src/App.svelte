<script>
    import { onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    import Sidebar from './lib/Sidebar.svelte';
    import Topbar from './lib/Topbar.svelte';
    import Player from './lib/Player.svelte';
    import FullPlayer from './lib/FullPlayer.svelte';
    import RightSidebar from './lib/RightSidebar.svelte';
    
    import Library from './lib/views/Library.svelte';
    import Artist from './lib/views/Artist.svelte';
    import Album from './lib/views/Album.svelte';
    import Settings from './lib/views/Settings.svelte';
    import TopPlayed from './lib/views/TopPlayed.svelte';
    import ThePool from './lib/views/ThePool.svelte';
    import Offline from './lib/views/Offline.svelte';
    import Downloader from './lib/views/Downloader.svelte';
    
    import { api } from './lib/api.js';
    import { allTracks, artistsMap, albumsMap, accentColor, isGlobalColorActive, isMaxGlassActive } from './store.js';

    let currentHash = '';
    let isMobileSidebarOpen = false;
    let isScrolled = false;
    let isLoading = true;
    let isFullPlayerOpen = false;
    let apiError = null;
    
    let requiresLogin = false;
    let loginUsername = '';
    let loginPassword = '';
    let loginErrorMsg = '';
    let isLoggingIn = false;

    $: navContextTitle = currentHash.startsWith('#album/') ? 'Album' 
                       : currentHash.startsWith('#artist/') ? 'Artist'
                       : currentHash === '#settings' ? 'Settings' 
                       : currentHash === '#top' ? 'Top Played'
                       : currentHash === '#all' ? 'The Pool'
                       : currentHash === '#offline' ? 'Available Offline'
                       : currentHash === '#downloader' ? 'Downloader'
                       : 'Library';

    const bootEngine = async () => {
        try {
            let isAuthError = false;

            const data = await api.getTracks().catch(e => {
                if (e.message === 'UNAUTHORIZED') isAuthError = true;
                return [];
            });

            if (isAuthError) {
                requiresLogin = true;
                isLoading = false;
                return;
            }

            const statsData = await api.getStats().catch(() => null);

            if (!data || data.length === 0) {
                apiError = "Nessuna traccia trovata o Backend offline.";
            } else {
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
                    track.playCount = statsMap.get(track.id) || track.playCount || 0;
                    const artist = track.album.artist;
                    const album = track.album;
                    
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
            }
        } catch (e) {
            apiError = "Impossibile connettersi al backend Arch.";
        } finally {
            isLoading = false;
        }
    };
    
    onMount(() => {
        currentHash = window.location.hash;
        const handleHashChange = () => { 
            currentHash = window.location.hash; 
            isMobileSidebarOpen = false; 
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        window.addEventListener('hashchange', handleHashChange);
        bootEngine();
        return () => window.removeEventListener('hashchange', handleHashChange);
    });

    const handleScroll = (e) => { isScrolled = e.target.scrollTop > 50; };

    const executeLogin = async () => {
        if (!loginUsername || !loginPassword) {
            loginErrorMsg = "Compila tutti i campi.";
            return;
        }
        
        isLoggingIn = true;
        loginErrorMsg = '';
        
        const res = await api.login({
            username: loginUsername,
            password: loginPassword
        });

        if (res && res.ok) {
            requiresLogin = false;
            isLoading = true;
            bootEngine();
        } else {
            loginErrorMsg = "Credenziali non valide. Riprova.";
            isLoggingIn = false;
        }
    };
</script>

{#if isLoading}
    <div id="loader-overlay" class="active" out:fade={{duration: 300}}><div class="spinner"></div></div>
{/if}

{#if requiresLogin}
    <div class="auth-overlay" in:fade={{duration: 300}}>
        <div class="auth-card">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <h2>Accesso Richiesto</h2>
            
            <form on:submit|preventDefault={executeLogin} class="auth-form">
                <input type="text" bind:value={loginUsername} placeholder="Username o Email" required disabled={isLoggingIn} autocomplete="username">
                <input type="password" bind:value={loginPassword} placeholder="Password" required disabled={isLoggingIn} autocomplete="current-password">
                
                {#if loginErrorMsg}
                    <div class="auth-error">{loginErrorMsg}</div>
                {/if}
                
                <button type="submit" class="btn-auth" disabled={isLoggingIn}>
                    {isLoggingIn ? 'Autenticazione in corso...' : 'Entra'}
                </button>
            </form>
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
            <Topbar {isScrolled} navContext={navContextTitle} currentHash={currentHash} on:toggleSidebar={() => isMobileSidebarOpen = !isMobileSidebarOpen} />
            
            <div id="main-content" style="position: relative;">
                {#key currentHash}
                <div in:fade={{duration: 250, delay: 100}} out:fade={{duration: 100}} style="position: absolute; width: 100%;">
                    {#if currentHash === '' || currentHash === '#' || currentHash === '#/'}
                        <Library />
                    {:else if currentHash.startsWith('#artist/')}
                        <Artist artistId={currentHash.split('/')[1]} />
                    {:else if currentHash.startsWith('#album/')}
                        <Album albumId={currentHash.split('/')[1]} />
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
                        <div style="padding: 24px; color: var(--text-secondary);">Rotta non trovata.</div>
                    {/if}
                </div>
                {/key}
            </div>
        </main>

        <aside id="right-sidebar">
            <RightSidebar />
        </aside>
    </div>

    <Player on:toggleFull={() => isFullPlayerOpen = !isFullPlayerOpen} />
    <FullPlayer isOpen={isFullPlayerOpen} on:close={() => isFullPlayerOpen = false} />
</div>
{/if}

<style>
    /* 1. RESET E LAYOUT GLOBALE */
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

    /* 2. MAX GLASS LAYOUT - ESTETICA */
    .app-row.max-glass-layout {
        padding: 16px 16px 0 16px;
        gap: 16px;
        align-items: flex-start;
    }

    /* Stile base aside (Standard) */
    :global(.app-row > aside) {
        background: rgba(0, 0, 0, 0.02) !important;
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border-right: 1px solid rgba(255,255,255,0.05);
    }

    /* Effetto Glass Avanzato */
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

    /* 3. CARD INTERNE (Accelerazione HW) */
    :global(.max-glass-layout .album-card), :global(.max-glass-layout .artist-card), 
    :global(.max-glass-layout .playlist-card), :global(.max-glass-layout .grid-item) {
        background: rgba(255, 255, 255, 0.05) !important;
        backdrop-filter: blur(24px) saturate(120%) !important;
        -webkit-backdrop-filter: blur(24px) saturate(120%) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 24px !important;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2), inset 1px 1px 0 rgba(255,255,255,0.1) !important;
        overflow: hidden;
        transform: translate3d(0,0,0);
    }

    /* 4. COMPONENTI DI SISTEMA */
    :global(main#main-view) { flex: 1; overflow-y: auto; position: relative; }
    :global(#topbar) { z-index: 10000 !important; position: relative !important; }

    :global(#right-sidebar) {
        width: 420px !important;
        min-width: 420px !important;
        flex-shrink: 0 !important;
        border-left: 1px solid rgba(255,255,255,0.05);
    }

    /* 5. SFONDI DINAMICI E AUTH */
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

    .auth-overlay {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: #000; display: flex; align-items: center; justify-content: center;
        z-index: 999999;
    }

    .auth-card {
        background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);
        padding: 48px; border-radius: 16px; text-align: center; max-width: 400px;
        backdrop-filter: blur(20px); box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }

    .auth-form input {
        width: 100%; padding: 14px; background: rgba(0,0,0,0.5); color: white;
        border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; outline: none;
    }

    .btn-auth {
        background: var(--accent-color); color: black; border: none; padding: 14px;
        font-size: 16px; font-weight: bold; border-radius: 30px; cursor: pointer;
    }

    /* 6. MEDIA QUERIES (FIX MOBILE ANTI-GLITCH) */
    @media (max-width: 768px) {
        .app-row.max-glass-layout { padding: 12px 12px 0 12px; gap: 12px; }

        /* Sidebar Posizionamento Mobile */
        :global(.app-row > aside:first-child) {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            height: 100dvh !important;
            z-index: 100005 !important;
            padding-bottom: 140px !important;
        }

        /* Sidebar Mobile Glass - Focus sul movimento pulito */
        :global(.app-row.max-glass-layout > aside:first-child) {
            top: 12px !important;
            left: 12px !important;
            height: calc(100dvh - 24px) !important;
            width: calc(100vw - 24px) !important;
            border-radius: 20px !important;
            
            /* Pointer events con transizione per evitare glitch al click durante chiusura */
            pointer-events: none;
            transition: pointer-events 0s linear 0.3s; 
            /* Rimosso transform: qui non deve esserci, lo gestisce il componente Sidebar */
        }

        /* Se aperta, abilita i click istantaneamente */
        :global(.app-row.max-glass-layout > aside:first-child.open) {
            pointer-events: auto !important;
            transition: pointer-events 0s linear 0s;
        }

        :global(.app-row.max-glass-layout > main#main-view) {
            border-radius: 20px !important;
        }
    }
</style>