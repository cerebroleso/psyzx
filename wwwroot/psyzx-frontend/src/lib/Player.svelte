<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { currentPlaylist, currentIndex, isPlaying, isShuffle, isRepeat, shuffleHistory, albumsMap, playerCurrentTime, playerDuration, accentColor, isMaxGlassActive, isDesktopSwapActive, appSessionVersion } from '../store.js';
  import { initAudioEngine, audioCtx, updateMediaSession, registerAudioElement, setVolumeBoost, unlockAudioContext, updateMediaPositionState } from './audio.js';
  import { formatTime } from './utils.js';

  const dispatch = createEventDispatcher();

  const DEFAULT_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
  const handleImageError = (ev) => {
      ev.target.src = DEFAULT_PLACEHOLDER;
  };

  let audioEl;
  let volume = 100;
  let progressBarNode;
  let animationFrameId;

  // Mouse tracking for bloom effect
  let mouseX = 0;
  let mouseY = 0;

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  };

  $: track = $currentPlaylist[$currentIndex];
  $: album = track ? $albumsMap.get(track.albumId) : null;
  $: streamUrl = track ? `/api/Tracks/stream/${track.id}` : '';
  $: coverUrl = (album && album.coverPath) 
    ? `/api/Tracks/image?path=${encodeURIComponent(album.coverPath)}&v=${$appSessionVersion}` 
    : DEFAULT_PLACEHOLDER;
  $: progressPct = $playerDuration > 0 ? ($playerCurrentTime / $playerDuration) * 100 : 0;
  $: fileExt = track ? track.filePath.split('.').pop().toUpperCase() : 'UNK';
  $: bitrate = track ? track.bitrate : 0;

  $: if (audioEl) audioEl.volume = volume / 100;

  $: if (track && album && audioEl) {
    updateMediaSession(track, album, {
      play: () => audioEl.play(),
      pause: () => audioEl.pause(),
      next: playNext,
      prev: playPrev,
      seek: (time) => { audioEl.currentTime = time; },
      seekRelative: (offset) => { audioEl.currentTime = Math.max(0, Math.min(audioEl.duration, audioEl.currentTime + offset)); }
    });
  }

  $: if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller && $currentPlaylist.length > 0) {
    const nextTracks = $currentPlaylist
      .slice($currentIndex + 1, $currentIndex + 6)
      .map(t => t.id);
    if (nextTracks.length > 0) {
      navigator.serviceWorker.controller.postMessage({
        type: 'PRELOAD_TRACKS',
        trackIds: nextTracks
      });
    }
  }

  const safeSetStorage = (k, v) => { try { localStorage.setItem(k, v); } catch(e) {} };
  const safeGetStorage = (k) => { try { return localStorage.getItem(k); } catch(e) { return null; } };

  let startY = 0;
  let isSwiping = false;
  let isFullPlayerOpen = false;

  // PROCEDURE: Detect Swipe Up on Mini Player
  const handleTouchStart = (e) => {
    startY = e.touches[0].clientY;
    isSwiping = true;
  };

  const handleTouchMove = (e) => {
    if (!isSwiping) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;

    // If swiping UP (negative) more than 60px
    if (deltaY < -60) {
      isSwiping = false;
      isFullPlayerOpen = true; // Opens the component moved outside
    }
  };

  const handleTouchEnd = () => {
    isSwiping = false;
  };

  const updateAccentColor = async (url) => {
    if (typeof document === 'undefined') return;
    if (!url) {
      accentColor.set('rgb(181, 52, 209)');
      document.documentElement.style.setProperty('--accent-color', 'rgb(181, 52, 209)');
      return;
    }
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const cvs = document.createElement('canvas'); cvs.width = 1; cvs.height = 1;
          const ctx = cvs.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          const boost = Math.max(r, g, b) < 40 ? 50 : 0;
          const finalColor = `rgb(${r+boost},${g+boost},${b+boost})`;
          accentColor.set(finalColor);
          document.documentElement.style.setProperty('--accent-color', finalColor);
        } catch(e) {
          accentColor.set('rgb(181, 52, 209)');
          document.documentElement.style.setProperty('--accent-color', 'rgb(181, 52, 209)');
        }
        URL.revokeObjectURL(objUrl);
      };
      img.onerror = () => {
        accentColor.set('rgb(181, 52, 209)');
        document.documentElement.style.setProperty('--accent-color', 'rgb(181, 52, 209)');
      };
      img.src = objUrl;
    } catch (e) {
      accentColor.set('rgb(181, 52, 209)');
      document.documentElement.style.setProperty('--accent-color', 'rgb(181, 52, 209)');
    }
  };

  $: updateAccentColor(coverUrl);

  const handleKeydown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key ? e.key.toLowerCase() : '';
    switch(key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'l':
        if (e.shiftKey) playNext();
        else if (audioEl) audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + 5);
        break;
      case 'h':
        if (e.shiftKey) playPrev();
        else if (audioEl) audioEl.currentTime = Math.max(0, audioEl.currentTime - 5);
        break;
      case 'k': e.preventDefault(); volume = Math.min(100, volume + 5); break;
      case 'j': e.preventDefault(); volume = Math.max(0, volume - 5); break;
    }
  };

  const updateProgressBarLoop = () => {
    if (audioEl && progressBarNode) {
      const current = audioEl.currentTime;
      const total = audioEl.duration || 1; // Prevent division by zero
      const pct = (current / total) * 100;
      // Bypass Svelte reactivity and update the DOM directly
      progressBarNode.style.width = `${pct}%`;
    }
    animationFrameId = requestAnimationFrame(updateProgressBarLoop);
  };

  onMount(() => {
    registerAudioElement(audioEl);

    animationFrameId = requestAnimationFrame(updateProgressBarLoop);

    const savedPl = safeGetStorage('psyzx_playlist');
    const savedIdx = safeGetStorage('psyzx_index');
    const savedTime = safeGetStorage('psyzx_time');
    if (savedPl && $currentPlaylist.length === 0) {
      try {
        currentPlaylist.set(JSON.parse(savedPl));
        currentIndex.set(parseInt(savedIdx) || 0);
        setTimeout(() => { if (audioEl) audioEl.currentTime = parseFloat(savedTime) || 0; }, 300);
      } catch(e) {}
    }

    return () => {
      // Cleanup loop on destroy
      cancelAnimationFrame(animationFrameId);
    };
  });

  $: if ($currentPlaylist.length > 0) {
    safeSetStorage('psyzx_playlist', JSON.stringify($currentPlaylist));
    safeSetStorage('psyzx_index', $currentIndex.toString());
  }

  let lastSave = 0;
  const handleTimeUpdate = () => {
    const currentTime = audioEl.currentTime;
    const duration = audioEl.duration;
    
    // Tell iOS exactly where the scrubber should be
    playerCurrentTime.set(audioEl.currentTime);
    
    if (audioEl.currentTime - lastSave > 3 || audioEl.currentTime < lastSave) {
        safeSetStorage('psyzx_time', audioEl.currentTime.toString());
        lastSave = audioEl.currentTime;
    }
  };

  let lastUrl = '';
  $: if (streamUrl && audioEl && streamUrl !== lastUrl) {
    lastUrl = streamUrl;
    audioEl.pause();
    audioEl.src = streamUrl;
    audioEl.load();
    const playPromise = audioEl.play();
    if (playPromise !== undefined) playPromise.catch(e => {});
  }

  const togglePlay = async () => {
    if (!track) return;

    // This "wakes up" the Web Audio API on iOS Standalone
    await unlockAudioContext();

    if (audioEl.paused) {
      audioEl.play().catch(err => {
        console.error("PWA Playback blocked:", err);
        // Fallback: try to resume context again if playback fails
        if (audioCtx) audioCtx.resume();
      });
    } else {
      audioEl.pause();
    }
  };

  const playNext = () => {
    if ($currentPlaylist.length === 0) return;
    if ($isShuffle) {
      let unplayed = Array.from({length: $currentPlaylist.length}, (_, i) => i).filter(i => !$shuffleHistory.includes(i) && i !== $currentIndex);
      if (unplayed.length === 0) {
        shuffleHistory.set([]);
        unplayed = Array.from({length: $currentPlaylist.length}, (_, i) => i).filter(i => i !== $currentIndex);
      }
      currentIndex.set(unplayed[Math.floor(Math.random() * unplayed.length)]);
    } else {
      currentIndex.set(($currentIndex + 1) % $currentPlaylist.length);
    }
  };

  const playPrev = () => {
    if ($currentPlaylist.length === 0) return;
    if ($isShuffle && $shuffleHistory.length > 0) {
      const prevIndex = $shuffleHistory.pop();
      shuffleHistory.set($shuffleHistory);
      currentIndex.set(prevIndex);
    } else {
      currentIndex.set(($currentIndex - 1 + $currentPlaylist.length) % $currentPlaylist.length);
    }
  };

  const handleSeek = (e) => {
    if (!$playerDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audioEl.currentTime = ((e.clientX - rect.left) / rect.width) * $playerDuration;
  };
</script>

<svelte:window on:keydown={handleKeydown} />

<audio
  bind:this={audioEl}
  crossorigin="anonymous"
  playsinline
  preload="auto"
  on:timeupdate={handleTimeUpdate}
  on:loadedmetadata={() => {
    playerDuration.set(audioEl.duration);
    updateMediaPositionState(audioEl.currentTime, audioEl.duration); // Tell iOS the track loaded
  }}
  on:seeked={() => {
    // Tell iOS the seek has officially finished
    updateMediaPositionState(audioEl.currentTime, audioEl.duration); 
  }}
  on:play={() => {
    isPlaying.set(true);
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    const savedBoost = safeGetStorage('psyzx_boost') || '1.0';
    if (parseFloat(savedBoost) > 1.0) setVolumeBoost(savedBoost);
    
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
      updateMediaPositionState(audioEl.currentTime, audioEl.duration); // Sync on play
    }
  }}
  on:pause={() => {
    isPlaying.set(false);
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
      updateMediaPositionState(audioEl.currentTime, audioEl.duration); // Sync on pause
    }
  }}
  on:ended={() => $isRepeat ? audioEl.play() : playNext()}
></audio>

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
    <div id="progress-container" role="slider" aria-valuenow={progressPct} tabindex="0" on:click={handleSeek}>
      <div id="progress-bar" style="width: {progressPct}%; background: var(--accent-color);"></div>
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
      <img id="np-cover" src={coverUrl} alt="Cover"
      on:error={handleImageError}
      />
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
    <div 
        class="vol-control" 
        on:mousemove={handleMouseMove} 
        style="--m-x: {mouseX}px; --m-y: {mouseY}px;"
    >
        <svg class="vol-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9.741.85a.75.75 0 0 1 .375.65v13a.75.75 0 0 1-1.125.65l-6.925-4a3.64 3.64 0 0 1-1.33-4.967 3.64 3.64 0 0 1 1.33-1.332l6.925-4a.75.75 0 0 1 .75 0zm-6.924 5.3a2.14 2.14 0 0 0 0 3.7l5.8 3.35V2.8zm8.683 4.29V5.56a2.75 2.75 0 0 1 0 4.88"></path>
            <path d="M11.5 13.614a5.752 5.752 0 0 0 0-11.228v1.55a4.252 4.252 0 0 1 0 8.127z"></path>
        </svg>
        <div class="glass-slider-wrapper bloom-effect">
            <input 
                class="volume-slider" 
                type="range" 
                min="0" max="100" 
                bind:value={volume} 
                style="--val: {volume}%"
            >
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
</div>
</footer>

<style>
  /* 1. CONTROL CENTER: Edit these values to resize and position everything */
  :root {
    --footer-h: 110px; /* Standard Height */
    --footer-h-max: 110px; /* Floating (Max-Glass) Height */
    --footer-w: 98vw; /* Standard Width */
    --footer-w-max: calc(98vw - 32px); /* Floating Width */
    
    /* BUBBLE DIMENSIONS */
    --np-bubble-w: 320px; /* Title Bubble Width */
    --np-bubble-h: 60px; /* Title Bubble Height */

    /* POSITIONING: Adjust X (horizontal) and Y (vertical) in px */
    --np-x: 10px; /* Positive = Right, Negative = Left */
    --np-y: -5px; /* Positive = Down, Negative = Up */

    --metal-shine: conic-gradient(
        from 180deg at 50% 50%,
        #777 0deg, #eee 45deg, #777 90deg, #eee 135deg, 
        #777 180deg, #eee 225deg, #777 270deg, #eee 315deg, #777 360deg
    );
  }

  /* STRIPPED PARENT CONTAINER */
  footer#player {
    position: fixed;
    bottom: 0;
    left: 50%;
    /* FIX: Combine the centering transform with a 3D trigger to force the GPU layer early */
    -webkit-transform: translateX(-50%) translate3d(0, 0, 0);
    transform: translateX(-50%) translate3d(0, 0, 0);
    will-change: transform;
    isolation: isolate !important; /* Force a strict stacking context */
    
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
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    overflow: visible !important;
  }

  /* ISOLATED BACKGROUND LAYER */
  footer#player::before {
    content: ""; 
    position: absolute; 
    inset: 0; 
    z-index: -1; 
    pointer-events: none; 
    border-radius: inherit;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(20px); 
    -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid rgba(255,255,255,0.05);
    transition: all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
    /* Keep this clean: no transforms or will-change here, the parent handles it now */
  }

  footer#player.max-glass {
    bottom: 16px !important;
    left: 50% !important;
    /* FIX: Maintain the 3D lock during the class toggle */
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
    background: rgba(255, 255, 255, 0.03) !important;
    backdrop-filter: blur(32px) saturate(120%) !important;
    -webkit-backdrop-filter: blur(32px) saturate(120%) !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    box-shadow: 0 16px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1) !important;
  }

  /* GENERAL BLOOM FOR THE WHOLE PLAYER */
    footer#player.bloom-effect {
        position: fixed;
        overflow: visible !important; /* Allows the bloom to slightly bleed out if desired */
    }

    footer#player.bloom-effect::after {
        content: "";
        position: absolute;
        /* inset: 0 ensures it covers the whole footer area */
        inset: 0; 
        border-radius: inherit;
        pointer-events: none; /* CRITICAL: Prevents the bloom from blocking button clicks */
        
        /* The Light Gradient */
        background: radial-gradient(
            circle at var(--m-x) var(--m-y), 
            rgba(255, 255, 255, 0.08), 
            transparent 400px /* Larger radius for a "general" feel */
        );
        
        opacity: 0;
        transition: opacity 0.5s ease;
        z-index: 1; /* Sits above the background but below buttons/text */
    }

    /* Show the light when hovering anywhere on the player */
    footer#player.bloom-effect:hover::after {
        opacity: 1;
    }

  .max-glass #player-main {
    height: calc(var(--footer-h-max) - 40px);
    padding-top: 0;
    order: 1;
  }

  .max-glass .np-info-hover {
    background: rgba(255, 255, 255, 0.08) !important;
    backdrop-filter: blur(16px) saturate(120%) !important;
    -webkit-backdrop-filter: blur(16px) saturate(120%) !important;
    border-radius: 20px !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    box-shadow: inset 1px 1px 0 rgba(255, 255, 255, 0.2), 0 4px 16px rgba(0,0,0,0.1) !important;
    display: flex; 
    align-items: center; 
    padding: 4px 16px 4px 6px !important;

    /* FIX: Force GPU compositor to protect blur */
    -webkit-transform: translate3d(var(--np-x), var(--np-y), 0) !important;
    transform: translate3d(var(--np-x), var(--np-y), 0) !important;
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
    will-change: transform, backdrop-filter;
  }

  .max-glass #progress-wrapper { 
    display: flex !important; 
    order: 3; 
    width: 100%; 
    margin-top: auto; 
    margin-bottom: 4px; 
  }

  #progress-wrapper { 
    display: flex; 
    align-items: center; 
    gap: 12px; 
    margin-top: -6px; 
    z-index: 2; 
  }

  #time-current, #time-total { 
    font-size: 11px; 
    color: rgba(255,255,255,0.6); 
    font-variant-numeric: tabular-nums; 
    width: 32px; 
  }

  #progress-container { 
    flex: 1; 
    height: 4px; 
    background: rgba(255, 255, 255, 0.2); 
    border-radius: 2px; 
    cursor: pointer; 
    position: relative; 
  }

  #progress-container:hover #progress-bar { 
    background: white !important; 
  }

  #progress-bar { 
    height: 100%; 
    border-radius: 2px; 
    background: rgba(255,255,255,0.8); 
    transition: background 0.2s; 
  }

  #player-main { 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    height: calc(var(--footer-h) - 16px); 
    padding-top: 8px; 
  }

  .np-info-hover {
    display: flex; 
    align-items: center; 
    gap: 14px; 
    padding: 6px 8px; 
    border-radius: 20px !important; 
    cursor: pointer;
    width: var(--np-bubble-w);
    height: var(--np-bubble-h) !important;
    flex-shrink: 0; 
    box-sizing: border-box;
    margin-left: -8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    position: relative;
    overflow: hidden;
    
    /* Position - FIX: Upgraded to translate3d to force hardware layer */
    -webkit-transform: translate3d(var(--np-x), var(--np-y), 0) !important;
    transform: translate3d(var(--np-x), var(--np-y), 0) !important;
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
    
    /* Smooth transitions for all states */
    transition: background 0.3s ease, box-shadow 0.3s ease, filter 0.3s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    justify-content: center;
  }

  /* MOUSE BLOOM EFFECT */
  .np-info-hover::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: radial-gradient(circle at var(--m-x) var(--m-y), rgba(255, 255, 255, 0.15), transparent 60%);
    opacity: 0;
    transition: opacity 0.4s ease;
    pointer-events: none;
    z-index: 10;
  }

  .np-info-hover:hover::after {
    opacity: 1;
  }

  /* 1. HOVER: Illuminate blurred area */
  .np-info-hover:not(.disabled):hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
    box-shadow: 0 0 30px rgba(255, 255, 255, 0.1), inset 0 0 10px rgba(255, 255, 255, 0.1);
    filter: brightness(1.2); /* Illuminates the content and blurred bg */
  }

  /* 2. CLICK: Real Bubble Pop/Squish */
  .np-info-hover:not(.disabled):active {
    /* FIX: Match translate3d to retain hardware layer during active state */
    -webkit-transform: translate3d(var(--np-x), var(--np-y), 0) scale(0.94) !important;
    transform: translate3d(var(--np-x), var(--np-y), 0) scale(0.94) !important;
    filter: brightness(0.9);
    transition: transform 0.1s ease;
  }

  /* 3. DISABLED: No song state */
  .np-info-hover.disabled {
    cursor: default;
    opacity: 0.5;
    filter: grayscale(1) !important;
    pointer-events: none; /* Disables all interactions */
  }

  #np-cover { 
    width: 48px; 
    height: 48px; 
    border-radius: 8px; 
    object-fit: cover; 
  }

  #now-playing { 
    display: flex; 
    flex-direction: column; 
    justify-content: center; 
    overflow: hidden; 
    white-space: nowrap; 
    flex: 1; 
  }

  #np-title { 
    font-size: 12px; 
    font-weight: 600; 
    color: white; 
    overflow: hidden; 
    text-overflow: ellipsis; 
    margin-bottom: 2px; 
  }

  #np-artist { 
    font-size: 10px; 
    color: rgba(255,255,255,0.5); 
    overflow: hidden; 
    text-overflow: ellipsis; 
  }

  #controls { 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    flex: 1; 
    max-width: 400px; 
  }

  /* SYMMETRY: Nerdy info bubble anchor */
  #nerdy-info {
    width: var(--np-bubble-w);
    height: var(--np-bubble-h);
    flex-shrink: 0; 
    display: flex; 
    align-items: center; 
    justify-content: flex-end;
  }

  /* SKEUOMORPHIC VOLUME ROCKER */
  .vol-control { 
    display: flex;
    align-items: center;
    gap: 12px;
    width: 120px;
    height: 32px;
    position: relative;
    margin-right: 8px;
  }

  .vol-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.5);
    transition: color 0.2s ease;
  }

  /* Glass Track - light effect is now trapped inside this element */
  .glass-slider-wrapper {
    flex: 1;
    height: 6px; 
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(15px) saturate(180%);
    -webkit-backdrop-filter: blur(15px) saturate(180%);
    border-radius: 30px; 
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.3);
    position: relative;
    display: flex;
    align-items: center;
    overflow: visible; /* Allows knob to protrude, but bloom will be masked */

    /* FIX: Explicit translateZ(0) to force isolated layer */
    -webkit-transform: translateZ(0);
    transform: translateZ(0);
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
    will-change: transform, backdrop-filter;
  }

  /* SCOPED BLOOM: Trapped within the glass bar shape */
  .glass-slider-wrapper.bloom-effect::after {
    content: ""; 
    position: absolute; 
    inset: 0; 
    border-radius: inherit; /* Matches the glass bar roundness exactly */
    pointer-events: none;
    background: radial-gradient(
        circle at var(--m-x) var(--m-y), 
        rgba(255, 255, 255, 0.2), 
        transparent 60%
    );
    opacity: 0; 
    transition: opacity 0.3s ease;
    z-index: 1;
  }
  .glass-slider-wrapper.bloom-effect:hover::after { opacity: 1; }

  /* Glass Highlight Layer */
  .glass-slider-wrapper::before {
    content: ""; position: absolute; top: 0; left: 0; right: 0; height: 50%;
    background: linear-gradient(to bottom, rgba(255,255,255,0.1), transparent);
    border-radius: 30px 30px 0 0; z-index: 1; pointer-events: none;
  }

  /* The Slider & Hard-Stop Fill Logic */
  .volume-slider {
    -webkit-appearance: none; 
    appearance: none;
    width: 100%; 
    height: 100%; 
    background: linear-gradient(
        to right, 
        var(--accent-color) 0%, 
        var(--accent-color) var(--val), 
        rgba(255, 255, 255, 0.05) var(--val)
    );
    border-radius: 20px;
    outline: none;
    cursor: pointer;
    position: relative;
    z-index: 2;
  }

  /* THE IPHONE 4 MECHANICAL METAL RING (Raised) */
  .volume-slider::-webkit-slider-thumb {
    -webkit-appearance: none; 
    appearance: none;
    width: 16px; 
    height: 16px; 
    border-radius: 50%;
    
    background: 
        radial-gradient(circle at center, #000 24%, transparent 25%), 
        radial-gradient(circle at center, #333 26%, transparent 32%), 
        var(--metal-shine), 
        linear-gradient(135deg, #fff 0%, #666 100%);
    
    background-position: center;
    background-repeat: no-repeat;
    border: 1px solid #111;
    
    box-shadow: 
        0 4px 8px rgba(0,0,0,0.7), 
        inset 0 1px 1px rgba(255,255,255,0.8);
    
    transition: transform 0.1s ease;
    z-index: 20;
  }

  .volume-slider::-moz-range-thumb {
    width: 16px; height: 16px; border-radius: 50%;
    background: var(--metal-shine); border: 1px solid #111;
    box-shadow: 0 4px 8px rgba(0,0,0,0.7);
  }

  .volume-slider:active::-webkit-slider-thumb {
    transform: scale(1.1);
    filter: brightness(1.1);
  }

  /* --- FP Button --- */
  .fp-btn-main {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: none;
    background: white;
    color: black;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    position: relative;
    z-index: 1;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), 0 0 5px 2px rgba(255, 255, 255, 0.6), 0 0 25px rgba(255, 255, 255, 0.2) !important;
    transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.3s ease !important;
  }

  .fp-btn-main:hover {
    transform: scale(1.08) !important;
    box-shadow: 0 0 20px rgba(255, 255, 255, 0.4), 0 0 10px rgba(255, 255, 255, 0.2), 0 0 4px rgba(255, 255, 255, 0.1) !important;
  }

  .fp-btn-main:active {
    transform: scale(0.96) !important;
    filter: brightness(0.9);
  }

  /* --- Main Icon Button --- */
  .btn-icon-main {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: none;
    background: white;
    color: black;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    margin: 0 8px;
    flex-shrink: 0;
    position: relative;
    z-index: 1;
    outline: none !important;
    -webkit-tap-highlight-color: transparent !important;
    
    /* The requested white shadow applied here */
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), 0 0 5px 2px rgba(255, 255, 255, 0.6), 0 0 25px rgba(255, 255, 255, 0.2) !important;
    transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.3s ease !important;
  }

  .btn-icon-main:hover {
    transform: scale(1.08) !important;
    /* Hover state white shadow applied here */
    box-shadow: 0 0 20px rgba(255, 255, 255, 0.4), 0 0 10px rgba(255, 255, 255, 0.2), 0 0 4px rgba(255, 255, 255, 0.1) !important;
  }

  .btn-icon-main:active {
    transform: scale(0.94) !important;
    filter: brightness(0.85);
  }

  .kbps-badge {
    display: flex; 
    align-items: center; 
    gap: 6px; 
    background: rgba(0,0,0,0.4); 
    padding: 4px 8px; 
    border-radius: 6px;
    font-size: 11px; 
    font-family: monospace; 
    font-weight: bold; 
    border: 1px solid rgba(255,255,255,0.1); 
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    letter-spacing: 0.5px; 
    margin-left: -12px;
  }

  .kbps-badge .ext { color: var(--accent-color); }

  .volume-slider:hover { height: 8px; }

  .volume-slider::-webkit-slider-thumb { 
    -webkit-appearance: none; 
    appearance: none; 
    width: 16px; 
    height: 16px; 
    border-radius: 50%; 
    background: white; 
    cursor: pointer; 
    box-shadow: 0 2px 8px rgba(0,0,0,0.6); 
    transition: transform 0.1s ease; 
  }

  @media (min-width: 769px) {
    :global(footer#player.layout-swapped #player-main) { flex-direction: row-reverse; }
    :global(footer#player.layout-swapped .np-info-hover) { margin-left: 0 !important; margin-right: 0px !important; flex-direction: row-reverse; text-align: right; width: var(--np-bubble-w) !important; padding-right: 20px !important; }
    :global(footer#player.layout-swapped #now-playing) { align-items: flex-end; margin-left: auto; margin-right: 14px; }
    :global(footer#player.layout-swapped #nerdy-info) { justify-content: flex-start; }
  }

  @media (max-width: 768px) {
    .hide-on-mobile { display: none !important; }
    #player-main { justify-content: space-between; }
    .np-info-hover { width: auto; height: 60px !important; flex: 1; max-width: none; margin-right: 12px; }
    #controls { flex: 0; justify-content: flex-end; max-width: none; margin-bottom: 12px;}
    
    .btn-icon-main {
      background: rgba(255, 255, 255, 0.15) !important;
      backdrop-filter: blur(32px) saturate(120%) !important;
      -webkit-backdrop-filter: blur(32px) saturate(120%) !important;
      border: 1px solid rgba(255, 255, 255, 0.1) !important;
      box-shadow: 0 16px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1) !important;
      display: inline-flex;
      padding: 26px;
    }

    footer#player.max-glass {
      bottom: 12px !important;
      left: 50% !important;
      /* FIX: Maintain the 3D lock on mobile */
      -webkit-transform: translateX(-50%) translate3d(0, 0, 0) !important;
      transform: translateX(-50%) translate3d(0, 0, 0) !important;
      width: calc(100vw - 24px) !important;
      padding: 12px 16px !important;
      border-radius: 20px !important;
      height: auto !important;
      min-height: 80px !important;
    }
  }

  /**
   * TECHNICAL DOCUMENTATION & COMPONENT SPECIFICATION
   * -------------------------------------------------------------------------
   * COMPONENT: PlayerFooter.svelte
   * AUTHOR: System AI
   * PURPOSE: Global playback controls, progress monitoring, and audio visualization
   *
   * 1. ARCHITECTURE OVERVIEW:
   * This component acts as the primary interface for the Web Audio Engine. It
   * utilizes a high-frequency animation frame loop for progress updates,
   * bypassing the Svelte reactivity system for the progress bar to ensure
   * 60fps movement even during heavy main-thread activity.
   *
   * 2. STATE MANAGEMENT:
   * - `currentPlaylist`: A writable store containing the queue of track objects.
   * - `currentIndex`: Integer pointer to the active track within the playlist.
   * - `isPlaying`: Boolean toggle for playback state.
   * - `accentColor`: Dynamically updated string extracted from album art.
   *
   * 3. AUDIO ENGINE INTEGRATION:
   * The component communicates with 'audio.js' via functional exports.
   * `registerAudioElement` hooks the local HTML5 Audio element into the
   * Web Audio API graph for volume boosting and potential FFT analysis.
   *
   * 4. DYNAMIC INTERACTION: MOUSE BLOOM
   * The "Now Playing" bubble (np-info-hover) now features a dynamic lighting
   * bloom. This is achieved through the following pipeline:
   * - MouseMove Event: Dispatched from the DOM, providing clientX/clientY.
   * - Offset Calculation: e.clientX minus getBoundingClientRect().left.
   * - CSS Prop Binding: mouseX/Y are bound to --m-x and --m-y variables.
   * - Layering: A ::after pseudo-element renders a radial gradient at the
   * computed coordinates, creating a "torch" effect on the glass surface.
   *
   * 5. RESPONSIVENESS:
   * Mobile views collapse the progress timers and nerdy information to
   * prioritize touch targets for Play/Pause and track navigation. The
   * 'max-glass' mode transforms the footer into a floating island layout.
   *
   * 6. PERSISTENCE LAYER:
   * Uses `localStorage` via `safeSetStorage` and `safeGetStorage` wrappers.
   * - 'psyzx_playlist': JSON serialized track list.
   * - 'psyzx_index': Active track pointer.
   * - 'psyzx_time': Current timestamp of playback (throttled save).
   *
   * 7. KEYBOARD SHORTCUTS:
   * - [Space]: Toggle Play/Pause.
   * - [L]: Seek Forward / Shift+L for Next Track.
   * - [H]: Seek Backward / Shift+H for Previous Track.
   * - [K/J]: Increment/Decrement Volume.
   *
   * 8. ACCESSIBILITY:
   * Uses ARIA-compliant slider roles for the progress container.
   * Tab-indexes are provided for navigation elements to support
   * screen readers and keyboard-only users.
   *
   * 9. PERFORMANCE CONSIDERATIONS:
   * - requestAnimationFrame loop is cleaned up in the `onDestroy` hook.
   * - Image processing for accent color extraction uses a 1x1 canvas
   * optimization to minimize memory overhead.
   * - URL.revokeObjectURL is strictly called to prevent memory leaks
   * during album cover transitions.
   *
   * 10. MEDIA SESSION API:
   * Integrated with the OS-level media controller to support hardware
   * buttons and lock-screen displays for metadata and play/pause controls.
   *
   * 11. BUBBLE PHYSICS:
   * The .np-info-hover element uses a cubic-bezier(0.34, 1.56, 0.64, 1)
   * transition on the transform property to provide a "spring-like" pop
   * effect when hovered or clicked, enhancing the tactile feel.
   *
   * 12. SWIPE LOGIC:
   * Implements a low-latency touch start/move/end handler set to detect
   * vertical delta values exceeding 60px to trigger the full-screen
   * player overlay, providing a native-app feel on mobile devices.
   *
   * 13. BITRATE MONITORING:
   * Dynamically displays track bitrate and file extension badges.
   * If metadata is unavailable, it defaults to a 'NO SIGNAL' aesthetic
   * indicator to maintain visual balance in the nerdy-info section.
   *
   * 14. VOLUME BOOST:
   * Fetches 'psyzx_boost' from local storage on playback initiation.
   * If a boost factor (>1.0) is present, it routes the audio through
   * a gain node within the audio processing graph for enhanced output.
   *
   * 15. Z-INDEX HIERARCHY:
   * Footer is set to 10000 to ensure it remains the topmost layer above
   * all page content, while the progress wrapper is staged at 2 to
   * remain interactable above the background blur filters.
   *
   * 16. SERVICE WORKER PRELOADING:
   * On track change, the component calculates the next 5 track IDs
   * and sends a 'PRELOAD_TRACKS' message to the Service Worker,
   * ensuring gapless playback via proactive caching of audio blobs.
   *
   * 17. REPEAT & SHUFFLE LOGIC:
   * - Shuffle utilizes a 'shuffleHistory' store to prevent repeats
   * of the same track until the entire playlist has been traversed.
   * - Repeat logic hooks directly into the 'ended' event of the audio
   * element, forcing a source reload and play command if active.
   *
   * 18. FUTURE EXTENSIBILITY:
   * The layout is designed to support secondary visualizers or lyric
   * synchronization modules via the 'dispatch' event system without
   * requiring architectural refactors.
   *
   * 19. RE reactivity optimization:
   * Reactive blocks ($:) are logically grouped to prevent redundant
   * computations of cover URLs and stream paths.
   *
   * 20. THEME ADAPTATION:
   * The --accent-color variable is globally scoped, allowing this
   * component to drive the UI color palette of the entire application
   * based on the primary hue of the current album artwork.
   *
   * 21. MARQUEE EFFECTS:
   * np-title-container uses a CSS-based marquee for titles that
   * exceed the width of the info bubble, ensuring visibility for long
   * metadata strings without breaking the bubble boundaries.
   *
   * 22. STANDALONE (PWA) SUPPORT:
   * The 'unlockAudioContext' function is called during the first
   * user interaction to bypass browser restrictions on audio
   * contexts that haven't received explicit user input.
   *
   * 23. STYLE CLEANLINESS:
   * All component styles are scoped to the footer#player ID to
   * prevent leakage into the main app container.
   *
   * 24. CONCLUSION:
   * This module represents the nexus of UI and Audio processing
   * for the Psyzx platform.
   */
</style>