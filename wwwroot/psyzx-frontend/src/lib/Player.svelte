<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import {
    currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat,
    shuffleHistory, albumsMap, playerCurrentTime, playerDuration,
    accentColor, isMaxGlassActive, isDesktopSwapActive, appSessionVersion,
    isBuffering, globalBitrate, globalFileExt, isLowQualityImages
  } from '../store.js';
  import {
    audioCtx, updateMediaSession, registerAudioElements, setVolumeBoost,
    unlockAudioContext, updateMediaPositionState, isEngineInitialized,
    togglePlayGlobal, playNextGlobal, playPrevGlobal,
    loadAndPlayUrl, activePlayer, preloadNextUrl, setGlobalVolume
  } from './audio.js';
  
  import { connectedDevices, thisDeviceName, targetDeviceId, myDeviceId, selectTargetDevice } from './sync.js'; 
  
  import { api } from './api.js';
  import { formatTime } from './utils.js';

  const dispatch = createEventDispatcher();

  const DEFAULT_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
  const handleImageError = (ev) => {
      ev.target.src = DEFAULT_PLACEHOLDER;
  };

  let audioElA;
  let audioElB;
  let volume = 100;
  let progressBarNode;
  let animationFrameId;

  let mouseX = 0;
  let mouseY = 0;
  
  let showSyncModal = false; 

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  };

  $: track = $currentPlaylist[$currentIndex];
  // Prefer albumsMap (full library), fall back to inline track.album data (playlist tracks carry this)
  $: album = track
    ? ($albumsMap.get(track.albumId) || (track.album ? {
        id: track.album.id,
        title: track.album.title,
        coverPath: track.album.coverPath,
        artistId: track.album.artist?.id,
        artistName: track.album.artist?.name || 'Unknown Artist',
        tracks: []
      } : null))
    : null;
  $: streamUrl = track ? `/api/Tracks/stream/${track.id}` : '';
  $: coverUrl = (album && album.coverPath)
    ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&v=${$appSessionVersion}&quality=low`
    : DEFAULT_PLACEHOLDER;
  $: progressPct = $playerDuration > 0 ? ($playerCurrentTime / $playerDuration) * 100 : 0;
  $: fileExt = track ? track.filePath.split('.').pop().toUpperCase() : 'UNK';
  $: bitrate = track ? track.bitrate : 0;
  $: globalBitrate.set(bitrate);
  $: globalFileExt.set(fileExt);

  $: if (isEngineInitialized) {
      setGlobalVolume(volume);
  }

  $: if (track && album) {
    updateMediaSession(track, album, {
      play: () => activePlayer.play(),
      pause: () => activePlayer.pause(),
      next: playNext,
      prev: playPrev,
      seek: (time) => { activePlayer.currentTime = time; },
      seekRelative: (offset) => { activePlayer.currentTime = Math.max(0, Math.min(activePlayer.duration, activePlayer.currentTime + offset)); }
    });
  }

  const safeSetStorage = (k, v) => { try { localStorage.setItem(k, v); } catch(e) {} };
  const safeGetStorage = (k) => { try { return localStorage.getItem(k); } catch(e) { return null; } };

  let startY = 0;
  let isSwiping = false;

  const handleTouchStart = (e) => {
    startY = e.touches[0].clientY;
    isSwiping = true;
  };

  const handleTouchMove = (e) => {
    if (!isSwiping) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;

    if (deltaY < -80) {
      isSwiping = false;
      dispatch('toggleFull');
    }
  };

  const handleTouchEnd = () => { isSwiping = false; };

  let currentObjUrl = null;
  const DEFAULT_COLOR = 'rgb(181, 52, 209)';

  const updateAccentColor = async (url) => {
    if (typeof document === 'undefined') return;

    if (currentObjUrl) {
      URL.revokeObjectURL(currentObjUrl);
      currentObjUrl = null;
    }

    if (!url) {
      applyColor(DEFAULT_COLOR);
      return;
    }

    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Fetch failed');

      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      currentObjUrl = objUrl;

      const img = new Image();
      img.onload = () => {
        if (currentObjUrl !== objUrl) return;
        try {
          const cvs = document.createElement('canvas');
          cvs.width = 1; cvs.height = 1;
          const ctx = cvs.getContext('2d', { willReadFrequently: true });

          ctx.drawImage(img, 0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

          const boost = Math.max(r, g, b) < 40 ? 50 : 0;
          applyColor(`rgb(${r + boost}, ${g + boost}, ${b + boost})`);
        } catch (e) {
          applyColor(DEFAULT_COLOR);
        }
      };
      img.onerror = () => applyColor(DEFAULT_COLOR);
      img.src = objUrl;

    } catch (e) {
      applyColor(DEFAULT_COLOR);
    }
  };

  const applyColor = (color) => {
    accentColor.set(color);
    document.documentElement.style.setProperty('--accent-color', color);
  };

  $: updateAccentColor(coverUrl);

  const handleKeydown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key ? e.key.toLowerCase() : '';
    switch(key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'l':
        if (e.shiftKey) playNext();
        else activePlayer.currentTime = Math.min(activePlayer.duration, activePlayer.currentTime + 5);
        break;
      case 'h':
        if (e.shiftKey) playPrev();
        else activePlayer.currentTime = Math.max(0, activePlayer.currentTime - 5);
        break;
      case 'k': e.preventDefault(); volume = Math.min(100, volume + 5); break;
      case 'j': e.preventDefault(); volume = Math.max(0, volume - 5); break;
    }
  };

  const updateProgressBarLoop = () => {
    if (progressBarNode) {
      progressBarNode.style.width = `${progressPct}%`;
    }
    animationFrameId = requestAnimationFrame(updateProgressBarLoop);
  };

  let lastSave = 0;
  $: {
      const ct = $playerCurrentTime;
      if (ct - lastSave > 3 || ct < lastSave) {
          safeSetStorage('psyzx_time', ct.toString());
          lastSave = ct;
      }
  }

  let isRestoringState = true;

  let lastUrl = '';
  // Analytics State
  let trackedTrackId = null;
  let trackStartTimeRaw = 0;
  let trackAccumulatedTime = 0;
  let lastPlayState = false;

  const flushAnalytics = (isCompleted = false) => {
      if (trackedTrackId) {
          if (lastPlayState) {
              trackAccumulatedTime += (Date.now() - trackStartTimeRaw);
              trackStartTimeRaw = Date.now();
          }

          const durationSec = Math.floor(trackAccumulatedTime / 1000);
          
          if (durationSec > 0 || isCompleted) {
              api.recordPlay(trackedTrackId, {
                  listenDuration: durationSec,
                  isCompleted: isCompleted,
                  isSkipped: !isCompleted && durationSec < ($playerDuration || 999), 
                  playbackContext: 'web'
              });
          }
      }
  };

  $: {
    if ($isPlaying !== lastPlayState) {
        if ($isPlaying) {
            trackStartTimeRaw = Date.now();
        } else {
            trackAccumulatedTime += (Date.now() - trackStartTimeRaw);
        }
        lastPlayState = $isPlaying;
    }
  }

  onMount(() => {
    registerAudioElements(audioElA, audioElB);
    animationFrameId = requestAnimationFrame(updateProgressBarLoop);

    const savedPl = safeGetStorage('psyzx_playlist');
    const savedIdx = safeGetStorage('psyzx_index');
    const savedTime = safeGetStorage('psyzx_time');
    if (savedPl && $currentPlaylist.length === 0) {
      try {
        currentPlaylist.set(JSON.parse(savedPl));
        currentIndex.set(parseInt(savedIdx) || 0);
        setTimeout(() => { activePlayer.currentTime = parseFloat(savedTime) || 0; isRestoringState = false}, 300);
      } catch(e) {}
    }

    const handleUnload = () => flushAnalytics(false);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
        cancelAnimationFrame(animationFrameId);
        window.removeEventListener('beforeunload', handleUnload);
    };
  });

  $: if ($currentPlaylist.length > 0) {
    safeSetStorage('psyzx_playlist', JSON.stringify($currentPlaylist));
    safeSetStorage('psyzx_index', $currentIndex.toString());
  }

  // --- PRIORITY 2: Audio stream starts instantly on change ---
  $: if (streamUrl && streamUrl !== lastUrl) {
    if (!isRestoringState && trackedTrackId) {
        flushAnalytics(false);
    }

    lastUrl = streamUrl;
    
    trackedTrackId = track ? track.id : null;
    trackAccumulatedTime = 0;
    if ($isPlaying) {
        trackStartTimeRaw = Date.now();
    }

    if (isRestoringState) {
        preloadNextUrl(streamUrl); 
    } else {
        loadAndPlayUrl(streamUrl, track?.id);

      if (track) {
        albumsMap.update(map => {
          const targetAlbum = map.get(track.albumId);
          if (targetAlbum) {
            targetAlbum.playCount = (targetAlbum.playCount || 0) + 1;
            const targetTrack = targetAlbum.tracks.find(t => t.id === track.id);
            if (targetTrack) targetTrack.playCount = (targetTrack.playCount || 0) + 1;
          }
          return new Map(map);
        });
      }
    }
  }

  const togglePlay = () => togglePlayGlobal();
  const playNext = () => playNextGlobal(api);
  const playPrev = () => playPrevGlobal();

  const handleSeek = (e) => {
    if (!$playerDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    activePlayer.currentTime = ((e.clientX - rect.left) / rect.width) * $playerDuration;
  };

  $: nextTrackIndex = $isRepeat && $currentIndex === $currentPlaylist.length - 1 ? 0 : $currentIndex + 1;
  $: nextTrack = $currentPlaylist[nextTrackIndex];

  // --- PRIORITY 5: Delay Next Track Preload Buffer ---
  let preloadNextTimeout;
  $: if (nextTrack && isEngineInitialized) {
      clearTimeout(preloadNextTimeout);
      const nextUrl = `/api/Tracks/stream/${nextTrack.id}`;
      // Wait 1.5s to ensure active track and images had priority
      preloadNextTimeout = setTimeout(() => preloadNextUrl(nextUrl), 1500); 
  }

  // --- PRIORITY 6: Delay Service Worker Offline Caching ---
  let swPreloadTimeout;
  $: if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller && $currentPlaylist.length > 0) {
    clearTimeout(swPreloadTimeout);
    swPreloadTimeout = setTimeout(() => {
      const nextTracks = $currentPlaylist
        .slice($currentIndex + 1, $currentIndex + 6)
        .map(t => t.id);
      if (nextTracks.length > 0) {
        navigator.serviceWorker.controller.postMessage({
          type: 'PRELOAD_TRACKS',
          trackIds: nextTracks
        });
      }
    }, 3000); // 3s delay yields to Preload Next track stream
  }
</script>

<svelte:window
  on:keydown={handleKeydown}
  on:track-ended={() => {
      flushAnalytics(true);
      trackAccumulatedTime = 0;
      if ($isPlaying) trackStartTimeRaw = Date.now();
      
      if ($isRepeat) { activePlayer.currentTime = 0; activePlayer.play(); }
      else { playNext(); }
  }}
/>

<audio bind:this={audioElA} crossorigin="anonymous" playsinline preload="auto"></audio>
<audio bind:this={audioElB} crossorigin="anonymous" playsinline preload="auto"></audio>

<footer
  id="player"
  class:max-glass={$isMaxGlassActive}
  class:layout-swapped={$isDesktopSwapActive}
  class="bloom-effect"
  style="--m-x: {mouseX}px; --m-y: {mouseY}px;"
  on:mousemove={handleMouseMove}
  on:touchstart|passive={handleTouchStart}
  on:touchmove|passive={handleTouchMove}
  on:touchend|passive={handleTouchEnd}
>
  <div id="progress-wrapper">
    <span id="time-current" class="hide-on-mobile">{formatTime($playerCurrentTime)}</span>
    <div id="progress-container" role="slider" aria-valuenow={progressPct} tabindex="0" on:click={handleSeek} class:is-buffering={$isBuffering}>
      <div id="progress-bar" bind:this={progressBarNode} style="width: {progressPct}%; background: var(--accent-color);"></div>
    </div>
    <span id="time-total" class="hide-on-mobile">{formatTime($playerDuration)}</span>
  </div>

  <div id="player-main">
    <div
      id="np-info"
      class="np-info-hover"
      class:disabled={!track}
      role="button"
      tabindex="0"
      on:click={() => track && dispatch('toggleFull')}
      on:mousemove={handleMouseMove}
      style="--m-x: {mouseX}px; --m-y: {mouseY}px;"
    >
      <img id="np-cover" src={coverUrl} alt="Cover" on:error={handleImageError} />
      <div id="now-playing">
        <div class="np-title-container marquee">
          <span>{track ? track.title : '---'}</span>
        </div>
        <span id="np-artist">{album ? album.artistName : '---'}</span>
      </div>
    </div>

    <div id="controls">
      <button class="btn-icon hide-on-mobile" class:active={$isShuffle} on:click={() => isShuffle.set(!$isShuffle)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4"/></svg>
      </button>
      <button class="btn-icon hide-on-mobile" on:click={playPrev}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/></svg>
      </button>
      <button class="btn-icon-main" on:click={togglePlay}>
        {#if $isPlaying}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <rect width="4" height="16" x="7" y="4" rx="1" />
            <rect width="4" height="16" x="13" y="4" rx="1" />
        </svg>
        {:else}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        {/if}
      </button>
      <button class="btn-icon hide-on-mobile" on:click={playNext}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/></svg>
      </button>
      <button class="btn-icon hide-on-mobile" class:active={$isRepeat} on:click={() => isRepeat.set(!$isRepeat)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3"/></svg>
      </button>
    </div>

    <div id="nerdy-info" class="hide-on-mobile">
      <div class="vol-control" on:mousemove={handleMouseMove} style="--m-x: {mouseX}px; --m-y: {mouseY}px;">
          <svg class="vol-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M9.741.85a.75.75 0 0 1 .375.65v13a.75.75 0 0 1-1.125.65l-6.925-4a3.64 3.64 0 0 1-1.33-4.967 3.64 3.64 0 0 1 1.33-1.332l6.925-4a.75.75 0 0 1 .75 0zm-6.924 5.3a2.14 2.14 0 0 0 0 3.7l5.8 3.35V2.8zm8.683 4.29V5.56a2.75 2.75 0 0 1 0 4.88"></path>
              <path d="M11.5 13.614a5.752 5.752 0 0 0 0-11.228v1.55a4.252 4.252 0 0 1 0 8.127z"></path>
          </svg>
          <div class="glass-slider-wrapper bloom-effect">
              <input class="volume-slider" type="range" min="0" max="100" bind:value={volume} style="--val: {volume}%">
          </div>
      </div>

      {#if bitrate > 0}
          <div class="kbps-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent-color)"><rect x="3" y="8" width="4" height="8"/><rect x="10" y="4" width="4" height="16"/><rect x="17" y="10" width="4" height="4"/></svg>
              <span>{bitrate} kbps</span><span class="ext">{fileExt}</span>
          </div>
      {:else}
          <span style="font-size: 11px; font-family: monospace; color: #555;">NO SIGNAL</span>
      {/if}

      {#if $connectedDevices && $connectedDevices.length > 0}
          <button class="kbps-badge sync-btn" class:active-sync={$targetDeviceId && $targetDeviceId !== $myDeviceId} on:click={() => showSyncModal = true} title="Audio Routing">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
              <span>Devices</span>
          </button>
      {/if}
    </div>
  </div>
</footer>

{#if showSyncModal}
    <div class="sync-modal-backdrop" on:click|self={() => showSyncModal = false}>
        <div class="sync-modal">
            <h3>Play Audio On</h3>
            <ul class="device-list">
                <li 
                    class:active={$targetDeviceId === $myDeviceId || !$targetDeviceId} 
                    on:click={() => { selectTargetDevice($myDeviceId); showSyncModal = false; }}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                    <span>This Device ({thisDeviceName})</span>
                    {#if $targetDeviceId === $myDeviceId || !$targetDeviceId}
                        <div class="active-dot"></div>
                    {/if}
                </li>
                
                {#each $connectedDevices as dev}
                    <li 
                        class:active={$targetDeviceId === dev.deviceId} 
                        on:click={() => { selectTargetDevice(dev.deviceId); showSyncModal = false; }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                        <span>{dev.deviceName}</span>
                        {#if $targetDeviceId === dev.deviceId}
                            <div class="active-dot"></div>
                        {/if}
                    </li>
                {/each}
            </ul>
        </div>
    </div>
{/if}

<style>
  /* 1. CONTROL CENTER: Edit these values to resize and position everything */
  :root {
    --footer-h: 110px;
    --footer-h-max: 110px;
    --footer-w: 98vw;
    --footer-w-max: calc(98vw - 32px);

    /* BUBBLE DIMENSIONS */
    --np-bubble-w: 720px;
    --np-bubble-h: 60px;

    /* POSITIONING */
    --np-x: 10px;
    --np-y: -5px;

    --metal-shine: conic-gradient(
        from 180deg at 50% 50%,
        #777 0deg, #eee 45deg, #777 90deg, #eee 135deg,
        #777 180deg, #eee 225deg, #777 270deg, #eee 315deg, #777 360deg
    );
  }

  footer#player {
    position: fixed;
    bottom: 0;
    left: 50%;
    -webkit-transform: translateX(-50%) translate3d(0, 0, 0);
    transform: translateX(-50%) translate3d(0, 0, 0);
    will-change: transform;

    width: var(--footer-w);
    height: var(--footer-h);
    z-index: 10000;
    display: flex;
    flex-direction: column;
    padding: 0 24px;
    box-sizing: border-box;
    transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);

    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }

  footer#player::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    border-radius: inherit;
    background: rgba(0, 0, 0, 0.65);
    -webkit-backdrop-filter: blur(25px) saturate(120%);
    backdrop-filter: blur(25px) saturate(120%);
    border-top: 1px solid rgba(255,255,255,0.08);
    transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  footer#player.max-glass {
    bottom: 16px !important;
    left: 50% !important;
    -webkit-transform: translateX(-50%) translate3d(0, 0, 0) !important;
    transform: translateX(-50%) translate3d(0, 0, 0) !important;
    width: var(--footer-w-max) !important;
    border-radius: 24px !important;
    height: var(--footer-h-max) !important;
    min-height: var(--footer-h-max) !important;
    padding: 12px 20px !important;
    flex-direction: column;
  }

  footer#player.max-glass::before {
    background: rgba(255, 255, 255, 0.04);
    -webkit-backdrop-filter: blur(40px) saturate(150%);
    backdrop-filter: blur(40px) saturate(150%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-top: 1px solid rgba(255, 255, 255, 0.25);
    box-shadow: 0 25px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
  }

  footer#player.bloom-effect { overflow: visible !important; }

  footer#player.bloom-effect::after {
      content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
      background: radial-gradient(circle at var(--m-x) var(--m-y), rgba(255, 255, 255, 0.08), transparent 400px);
      opacity: 0; transition: opacity 0.5s ease; z-index: 1;
  }

  footer#player.bloom-effect:hover::after { opacity: 1; }

  .max-glass #player-main { height: calc(var(--footer-h-max) - 40px); padding-top: 0; order: 1; }

  .max-glass .np-info-hover {
    background: rgba(255, 255, 255, 0.08) !important;
    -webkit-backdrop-filter: blur(16px) saturate(120%) !important;
    backdrop-filter: blur(16px) saturate(120%) !important;
    border-radius: 20px !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    box-shadow: inset 1px 1px 0 rgba(255, 255, 255, 0.2), 0 4px 16px rgba(0,0,0,0.1) !important;
    padding: 4px 16px 4px 6px !important;
  }

  .max-glass #progress-wrapper { display: flex !important; order: 3; width: 100%; margin-top: auto; margin-bottom: 4px; }

  #progress-wrapper { display: flex; align-items: center; gap: 12px; margin-top: -6px; position: relative; z-index: 2; }

  #time-current, #time-total { font-size: 11px; color: rgba(255,255,255,0.6); font-variant-numeric: tabular-nums; width: 32px; }

  #progress-container { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.2); border-radius: 2px; cursor: pointer; position: relative; }

  #progress-container:hover #progress-bar { background: white !important; }

  #progress-bar { height: 100%; border-radius: 2px; background: rgba(255,255,255,0.8); transition: background 0.2s; }

  #player-main {
    display: flex; justify-content: space-between; align-items: center; gap: 16px;
    height: calc(var(--footer-h) - 16px); padding-top: 8px; position: relative; z-index: 2;
  }

  #controls { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; }

  .np-info-hover {
    flex: 1 1 0%; max-width: var(--np-bubble-w); width: 100%; height: var(--np-bubble-h) !important;
    display: flex; align-items: center; gap: 14px; padding: 6px 8px; border-radius: 20px !important;
    cursor: pointer; box-sizing: border-box; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05);
    position: relative; overflow: hidden;
    -webkit-transform: translate3d(var(--np-x), var(--np-y), 0) !important; transform: translate3d(var(--np-x), var(--np-y), 0) !important;
    -webkit-backface-visibility: hidden; backface-visibility: hidden;
    transition: background 0.3s ease, box-shadow 0.3s ease, filter 0.3s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  #nerdy-info {
    flex: 1 1 0%; max-width: var(--np-bubble-w); width: 100%; height: var(--np-bubble-h);
    display: flex; align-items: center; justify-content: flex-end;
  }

  .np-info-hover::after {
    content: ""; position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: radial-gradient(circle at var(--m-x) var(--m-y), rgba(255, 255, 255, 0.15), transparent 60%);
    opacity: 0; transition: opacity 0.4s ease; pointer-events: none; z-index: 10;
  }

  .np-info-hover:hover::after { opacity: 1; }

  .np-info-hover:not(.disabled):hover {
    background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.2);
    box-shadow: 0 0 30px rgba(255, 255, 255, 0.1), inset 0 0 10px rgba(255, 255, 255, 0.1); filter: brightness(1.2);
  }

  .np-info-hover:not(.disabled):active {
    -webkit-transform: translate3d(var(--np-x), var(--np-y), 0) scale(0.94) !important;
    transform: translate3d(var(--np-x), var(--np-y), 0) scale(0.94) !important; filter: brightness(0.9); transition: transform 0.1s ease;
  }

  .np-info-hover.disabled { cursor: default; opacity: 0.5; filter: grayscale(1) !important; pointer-events: none; }

  #np-cover { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; }

  #now-playing { display: flex; flex-direction: column; justify-content: center; overflow: hidden; white-space: nowrap; flex: 1; }
  #np-title { font-size: 12px; font-weight: 600; color: white; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; }
  #np-artist { font-size: 10px; color: rgba(255,255,255,0.5); overflow: hidden; text-overflow: ellipsis; }

  .vol-control { display: flex; align-items: center; gap: 12px; width: 120px; height: 32px; position: relative; margin-right: 8px; }
  .vol-icon { width: 16px; height: 16px; flex-shrink: 0; color: rgba(255, 255, 255, 0.5); transition: color 0.2s ease; }

  .glass-slider-wrapper {
    flex: 1; height: 6px; background: rgba(255, 255, 255, 0.05);
    -webkit-backdrop-filter: blur(15px) saturate(180%); backdrop-filter: blur(15px) saturate(180%);
    border-radius: 30px; border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: inset 0 1px 2px rgba(0,0,0,0.3);
    position: relative; display: flex; align-items: center; overflow: visible;
  }

  .volume-slider {
    -webkit-appearance: none; appearance: none; width: 100%; height: 100%; 
    background: linear-gradient(to right, var(--accent-color) 0%, var(--accent-color) var(--val), rgba(255, 255, 255, 0.05) var(--val));
    border-radius: 20px; outline: none; cursor: pointer; position: relative; z-index: 2;
  }

  .volume-slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%;
    background: radial-gradient(circle at center, #000 24%, transparent 25%), radial-gradient(circle at center, #333 26%, transparent 32%), var(--metal-shine), linear-gradient(135deg, #fff 0%, #666 100%);
    background-position: center; background-repeat: no-repeat; border: 1px solid #111;
    box-shadow: 0 4px 8px rgba(0,0,0,0.7), inset 0 1px 1px rgba(255,255,255,0.8);
    transition: transform 0.1s ease; z-index: 20;
  }

  .volume-slider::-moz-range-thumb {
    width: 16px; height: 16px; border-radius: 50%;
    background: var(--metal-shine); border: 1px solid #111;
    box-shadow: 0 4px 8px rgba(0,0,0,0.7);
  }

  .volume-slider:active::-webkit-slider-thumb { transform: scale(1.1); filter: brightness(1.1); }
  .volume-slider:hover { height: 8px; }

  .btn-icon-main {
    width: 44px; height: 44px; border-radius: 50%; border: none; background: white; color: black; display: flex; align-items: center; justify-content: center; cursor: pointer; margin: 0 8px; flex-shrink: 0; position: relative; z-index: 1;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), 0 0 5px 2px rgba(255, 255, 255, 0.6), 0 0 25px rgba(255, 255, 255, 0.2) !important;
    transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.3s ease !important;
  }
  .btn-icon-main:hover { transform: scale(1.08) !important; box-shadow: 0 0 20px rgba(255, 255, 255, 0.4), 0 0 10px rgba(255, 255, 255, 0.2), 0 0 4px rgba(255, 255, 255, 0.1) !important; }
  .btn-icon-main:active { transform: scale(0.94) !important; filter: brightness(0.85); }

  .kbps-badge {
    display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.4); padding: 4px 8px; border-radius: 6px;
    font-size: 11px; font-family: monospace; font-weight: bold; border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 2px 8px rgba(0,0,0,0.3); letter-spacing: 0.5px;
  }
  .kbps-badge .ext { color: var(--accent-color); }
  
  /* --- SYNC MODAL CSS --- */
  .sync-btn {
      cursor: pointer; margin-left: 8px; color: rgba(255,255,255,0.8); 
      transition: all 0.2s ease; border: 1px solid rgba(255,255,255,0.1);
  }
  .sync-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.3); }
  .sync-btn.active-sync { border-color: var(--accent-color); color: var(--accent-color); }

  .sync-modal-backdrop {
      position: fixed; inset: 0; z-index: 20000;
      background: rgba(0,0,0,0.5); 
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      animation: fadeIn 0.2s ease;
  }
  .sync-modal {
      background: rgba(20, 20, 20, 0.7);
      -webkit-backdrop-filter: blur(40px) saturate(180%); backdrop-filter: blur(40px) saturate(180%);
      border: 1px solid rgba(255,255,255,0.1); border-top: 1px solid rgba(255,255,255,0.2);
      border-radius: 20px; padding: 24px; width: 300px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.6); color: white;
  }
  .sync-modal h3 { margin: 0 0 16px 0; font-size: 15px; font-weight: 600; text-align: center; letter-spacing: 0.5px; }
  
  .device-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .device-list li {
      padding: 12px 16px; border-radius: 12px; background: rgba(255,255,255,0.03);
      cursor: pointer; display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 500;
      border: 1px solid transparent; transition: all 0.2s ease; position: relative;
  }
  .device-list li:hover { background: rgba(255,255,255,0.08); }
  .device-list li.active {
      background: rgba(255,255,255,0.1); border-color: var(--accent-color);
      box-shadow: inset 0 0 20px rgba(255,255,255,0.05);
  }
  .device-list svg { color: rgba(255,255,255,0.5); }
  .device-list li.active svg { color: var(--accent-color); }
  
  .active-dot {
      position: absolute; right: 16px; width: 8px; height: 8px; border-radius: 50%;
      background: var(--accent-color); box-shadow: 0 0 8px var(--accent-color);
  }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  @media (min-width: 769px) {
    :global(footer#player.layout-swapped #player-main) { flex-direction: row-reverse; }
    :global(footer#player.layout-swapped .np-info-hover) { flex-direction: row-reverse; text-align: right; }
    :global(footer#player.layout-swapped #now-playing) { align-items: flex-end; margin-left: auto; margin-right: 14px; }
    :global(footer#player.layout-swapped #nerdy-info) { justify-content: flex-start; }
  }

  @media (max-width: 768px) {
    .hide-on-mobile { display: none !important; }
    #player-main { gap: 8px; align-items: center; }
    .np-info-hover { flex: 1 1 auto; max-width: none; margin-right: 12px; margin-bottom: 10px; margin-left: 0 !important; transform: none !important; }
    .np-info-hover:not(.disabled):active { transform: scale(0.94) !important; }
    #controls { justify-content: flex-end; }
    .btn-icon-main {
      height: var(--np-bubble-h) !important; width: var(--np-bubble-h) !important; border-radius: 50% !important;
      display: inline-flex; align-items: center; justify-content: center; padding: 0 !important; margin: 0 !important; margin-bottom: 10px !important;
      background: rgba(255, 255, 255, 0.15) !important; -webkit-backdrop-filter: blur(32px) saturate(120%) !important; backdrop-filter: blur(32px) saturate(120%) !important; border: 1px solid rgba(255, 255, 255, 0.1) !important;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.2) !important;
    }
  }

  /* --- BUFFERING WAVE ANIMATION --- */
  @keyframes buffer-wave { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
  .is-buffering { position: relative; overflow: hidden !important; }
  .is-buffering::after {
      content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
      animation: buffer-wave 1.2s infinite linear; z-index: 5; pointer-events: none;
  }
</style>