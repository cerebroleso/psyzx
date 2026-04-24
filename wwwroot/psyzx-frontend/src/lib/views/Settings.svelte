<script>
    import { onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    import { 
        isGlobalColorActive, isMaxGlassActive, isDesktopSwapActive, viewSize, 
        isCacheDebugActive, isGaplessModeActive, currentPlaylist, currentIndex, 
        isLowQualityImages, audioBitrate, visEnabled, visIntensity, visShape, 
        visMovement, visYPos, visDimension, visDetail, visSides 
    } from '../../store.js';
    import { setVolumeBoost, isWebAudioMode, setWebAudioGaplessMode } from '../audio.js';
    import { api } from '../api.js';

    let currentBoost = '1.0';
    let currentScrubSound = 'speed'; // FIX: Default set to speed to prevent visual flash
    let isScanning = false;

    onMount(() => {
        if (typeof window !== 'undefined') {
            currentBoost = localStorage.getItem('psyzx_boost') || '1.0';
            currentScrubSound = localStorage.getItem('psyzx_scrub_sound') || 'speed';
            
            // FIX: Enforce requested defaults if not set by the user yet
            if (localStorage.getItem('psyzx_webaudio_gapless') === null) {
                isGaplessModeActive.set(false);
                setWebAudioGaplessMode(false);
            }
            if (localStorage.getItem('psyzx_vis_shape') === null) {
                visShape.set('PSPWaves');
            }

            // Migration: old visIntensity used a 0-3.0 scale where 3.0 = 30x.
            // New scale is 0-0.5 where 0.3 = 3.0x display.
            // If the stored value exceeds the new max (0.5), convert it.
            const storedIntensity = parseFloat(localStorage.getItem('psyzx_vis_intensity'));
            if (!isNaN(storedIntensity) && storedIntensity > 0.5) {
                const migrated = (storedIntensity / 10).toFixed(2);
                visIntensity.set(migrated);
            }
        }

        setVolumeBoost(currentBoost);
        window.dispatchEvent(new CustomEvent('visualizer-update'));

        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_DEBUG_MODE',
                value: $isCacheDebugActive
            });
        }
    });

    const toggleLowQualityImages = () => isLowQualityImages.set(!$isLowQualityImages);

    const runScan = async (hard = false) => {
        if (isScanning) return;
        isScanning = true;
        try {
            await api.scanLibrary(hard);
        } catch (err) {
            alert("Scan failed: " + err.message);
        } finally {
            isScanning = false;
        }
    };

    const updateBoost = (e) => {
        const val = parseFloat(e.target.value).toFixed(1);
        currentBoost = val;
        if (typeof window !== 'undefined') localStorage.setItem('psyzx_boost', val);
        setVolumeBoost(val);
    };

    const updateScrubSound = (val) => {
        currentScrubSound = val;
        if (typeof window !== 'undefined') localStorage.setItem('psyzx_scrub_sound', val);
    };

    const toggleGlobalColor = () => isGlobalColorActive.set(!$isGlobalColorActive);
    const toggleMaxGlass = () => isMaxGlassActive.set(!$isMaxGlassActive);
    const toggleDesktopSwap = () => isDesktopSwapActive.set(!$isDesktopSwapActive);
    
    const updateViewSize = (size) => {
        viewSize.set(size);
        if (typeof window !== 'undefined') localStorage.setItem('psyzx_view_size', size);
    };

    const toggleCacheDebug = () => {
        const newVal = !$isCacheDebugActive;
        isCacheDebugActive.set(newVal);
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_DEBUG_MODE',
                value: newVal
            });
        }
    };

    const toggleGaplessMode = () => {
        const newState = !$isGaplessModeActive;
        isGaplessModeActive.set(newState);
        setWebAudioGaplessMode(newState);
        window.location.reload();
    }; 

    const refreshApp = async () => {
        if (typeof window === 'undefined' || !('caches' in window)) return window.location.reload();
        try {
            const keys = await caches.keys();
            await Promise.all(keys.filter(key => key.includes('core')).map(key => caches.delete(key)));
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (let reg of regs) await reg.unregister();
            }
            window.location.reload();
        } catch (e) {
            window.location.reload();
        }
    };

    const nukeCache = async () => {
        if (confirm('Are you sure? This will delete all cached tracks and settings.')) {
            if (typeof window !== 'undefined') localStorage.clear();
            if (typeof window !== 'undefined' && 'caches' in window) {
                try {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                    if ('serviceWorker' in navigator) {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (let reg of regs) await reg.unregister();
                    }
                } catch(e) {}
            }
            window.location.reload();
        }
    };
</script>

<div class="view-wrapper" in:fade={{duration: 200}}>
    <div class="settings-header">
        <h1>Settings</h1>
    </div>

    <div class="settings-section">
        <h2>Audio Engine</h2>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Audio Quality Cap</span>
                <span class="setting-desc">Maximum streaming bitrate for standard audio files.</span>
            </div>
            <div class="segmented-control">
                <button class:active={$audioBitrate === '320'} on:click={() => audioBitrate.set('320')}>320</button>
                <button class:active={$audioBitrate === '256'} on:click={() => audioBitrate.set('256')}>256</button>
                <button class:active={$audioBitrate === '192'} on:click={() => audioBitrate.set('192')}>192</button>
                <button class:active={$audioBitrate === '160'} on:click={() => audioBitrate.set('160')}>160</button>
            </div>
        </div>
        
        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">True Gapless (RAM Engine)</span>
                <span class="setting-desc">Bypasses HTML5 logic to force 0ms continuous audio using RAM buffers.</span>
            </div>
            <button class="toggle-btn" class:active={$isGaplessModeActive} on:click={toggleGaplessMode} aria-label="Toggle WebAudio RAM Engine">
                <div class="toggle-knob"></div>
            </button>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Progress Scrub Sound</span>
                <span class="setting-desc">Effect played when dragging the progress bar.</span>
            </div>
            <div class="segmented-control">
                <button class:active={currentScrubSound === 'vinyl'} on:click={() => updateScrubSound('vinyl')}>Vinyl</button>
                <button class:active={currentScrubSound === 'speed'} on:click={() => updateScrubSound('speed')}>Speed</button>
                <button class:active={currentScrubSound === 'beep'} on:click={() => updateScrubSound('beep')}>Beep</button>
                <button class:active={currentScrubSound === 'none'} on:click={() => updateScrubSound('none')}>Off</button>
            </div>
        </div>

        <div class="setting-item-col">
            <div class="setting-info w-full">
                <div class="flex-between">
                    <span class="setting-title">Gain Multiplier</span>
                    <span class="highlight-val">{currentBoost}x</span>
                </div>
                <span class="setting-desc mb-16">Increases the gain of the local player (up to 3x).</span>
            </div>
            <input class="range-slider" type="range" min="0.5" max="3.0" step="0.1" value={currentBoost} on:change={updateBoost} on:input={(e) => currentBoost = e.target.value}>
        </div>
    </div>

    <div class="settings-section">
        <h2>Visualizer (Canvas)</h2>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Enable 3D Visualizer</span>
                <span class="setting-desc">Renders hardware-accelerated graphics responding to audio.</span>
            </div>
            <button class="toggle-btn" class:active={$visEnabled} on:click={() => visEnabled.set(!$visEnabled)} aria-label="Toggle Visualizer">
                <div class="toggle-knob"></div>
            </button>
        </div>
        
        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Shape</span>
                <span class="setting-desc">The geometric form reflecting audio data.</span>
            </div>
            <div class="segmented-control">
                <button class:active={$visShape === 'TorusKnot'} on:click={() => visShape.set('TorusKnot')}>Knot</button>
                <button class:active={$visShape === 'Tunnel'} on:click={() => visShape.set('Tunnel')}>Tunnel</button>
                <button class:active={$visShape === 'DNA'} on:click={() => visShape.set('DNA')}>DNA</button>
                <button class:active={$visShape === 'Synthwave'} on:click={() => visShape.set('Synthwave')}>Synth</button>
                <button class:active={$visShape === 'PSPWaves'} on:click={() => visShape.set('PSPWaves')}>Waves</button>
                <button class:active={$visShape === 'PSPWaves2'} on:click={() => visShape.set('PSPWaves2')}>Waves2</button>
                <button class:active={$visShape === 'PSPWaves3'} on:click={() => visShape.set('PSPWaves3')}>Waves3</button>
            </div>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Movement</span>
                <span class="setting-desc">The base animated movement pattern.</span>
            </div>
            <div class="segmented-control">
                <button class:active={$visMovement === 'Hypnotic'} on:click={() => visMovement.set('Hypnotic')}>Hypnotic</button>
                <button class:active={$visMovement === 'Pulsate'} on:click={() => visMovement.set('Pulsate')}>Pulsate</button>
                <button class:active={$visMovement === 'None'} on:click={() => visMovement.set('None')}>None</button>
            </div>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Radial Segments</span>
                <span class="setting-desc">Adjusts sides for Tube/Tunnel forms.</span>
            </div>
            <div class="segmented-control">
                <button class:active={$visSides === 'Default'} on:click={() => visSides.set('Default')}>Auto</button>
                <button class:active={$visSides === '3'} on:click={() => visSides.set('3')}>3</button>
                <button class:active={$visSides === '4'} on:click={() => visSides.set('4')}>4</button>
                <button class:active={$visSides === '6'} on:click={() => visSides.set('6')}>6</button>
                <button class:active={$visSides === '12'} on:click={() => visSides.set('12')}>12</button>
            </div>
        </div>

        <div class="setting-item-col">
            <div class="setting-info w-full">
                <div class="flex-between">
                    <span class="setting-title">Beat Intensity</span>
                    <span class="highlight-val">{(parseFloat($visIntensity) * 10).toFixed(1)}x</span>
                </div>
                <span class="setting-desc mb-16">How violently the shape reacts to the FFT frequency data.</span>
            </div>
            <input class="range-slider" type="range" min="0.0" max="0.5" step="0.01" value={$visIntensity} on:input={(e) => visIntensity.set(e.target.value)}>
        </div>

        <div class="setting-item-col">
            <div class="setting-info w-full">
                <div class="flex-between">
                    <span class="setting-title">Y-Position (Vertical Offset)</span>
                    <span class="highlight-val">{$visYPos}</span>
                </div>
                <span class="setting-desc mb-16">Height positioning within the background.</span>
            </div>
            <input class="range-slider" type="range" min="-30" max="30" step="1" value={$visYPos} on:change={(e) => visYPos.set(e.target.value)}>
        </div>

        <div class="setting-item-col">
            <div class="setting-info w-full">
                <div class="flex-between">
                    <span class="setting-title">Dimension (Overall Scale)</span>
                    <span class="highlight-val">{$visDimension}x</span>
                </div>
                <span class="setting-desc mb-16">Multiplier for the visualizer's size.</span>
            </div>
            <input class="range-slider" type="range" min="0.5" max="3.0" step="0.1" value={$visDimension} on:change={(e) => visDimension.set(e.target.value)}>
        </div>

        <div class="setting-item-col">
            <div class="setting-info w-full">
                <div class="flex-between">
                    <span class="setting-title">Detail Level (Geometry)</span>
                    <span class="highlight-val">{$visDetail}</span>
                </div>
                <span class="setting-desc mb-16">Complexity of the 3D mesh. Higher numbers cost more GPU power.</span>
            </div>
            <select class="sleek-select" value={$visDetail} on:change={(e) => visDetail.set(e.target.value)}>
                <option value="4">4 (Lowest)</option>
                <option value="8">8 (Low)</option>
                <option value="16">16 (Normal)</option>
                <option value="32">32 (High)</option>
                <option value="64">64 (Ultra)</option>
                <option value="128">128 (Extreme - Warning)</option>
            </select>
        </div>
    </div>

    <div class="settings-section">
        <h2>UI & Look</h2>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Low Quality Images (Data Saver)</span>
                <span class="setting-desc">Loads compressed thumbnails to save bandwidth.</span>
            </div>
            <button class="toggle-btn" class:active={$isLowQualityImages} on:click={toggleLowQualityImages} aria-label="Toggle Low Quality Images">
                <div class="toggle-knob"></div>
            </button>
        </div>
        
        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Grid Layout Size</span>
                <span class="setting-desc">Adjust the scaling of album covers across the app.</span>
            </div>
            <div class="segmented-control">
                <button class:active={$viewSize === 'large'} on:click={() => updateViewSize('large')}>L</button>
                <button class:active={$viewSize === 'medium'} on:click={() => updateViewSize('medium')}>M</button>
                <button class:active={$viewSize === 'small'} on:click={() => updateViewSize('small')}>S</button>
            </div>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Dynamic Background</span>
                <span class="setting-desc">Applies the color of the active album globally.</span>
            </div>
            <button class="toggle-btn" class:active={$isGlobalColorActive} on:click={toggleGlobalColor} aria-label="Toggle Global Background">
                <div class="toggle-knob"></div>
            </button>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Max Glassmorphism</span>
                <span class="setting-desc">Enables heavy transparency and blur elements.</span>
            </div>
            <button class="toggle-btn" class:active={$isMaxGlassActive} on:click={toggleMaxGlass} aria-label="Toggle Max Glass">
                <div class="toggle-knob"></div>
            </button>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Invert Status Bar Layout (Desktop)</span>
                <span class="setting-desc">Moves track's info to the right.</span>
            </div>
            <button class="toggle-btn" class:active={$isDesktopSwapActive} on:click={toggleDesktopSwap} aria-label="Toggle Layout Swap">
                <div class="toggle-knob"></div>
            </button>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Developer: Bypass Cache</span>
                <span class="setting-desc">Disables aggressive caching.</span>
            </div>
            <button class="toggle-btn" class:active={$isCacheDebugActive} on:click={toggleCacheDebug} aria-label="Toggle Cache Debug">
                <div class="toggle-knob"></div>
            </button>
        </div>
    </div>

    <div class="settings-section">
        <h2>Library</h2>
        
        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Refresh Library</span>
                <span class="setting-desc">Scans for new files and removes deleted tracks.</span>
            </div>
            <button class="btn-action" on:click={() => runScan(false)} disabled={isScanning}>
                {isScanning ? 'Scanning...' : 'Scan Now'}
            </button>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Deep Metadata Sweep</span>
                <span class="setting-desc">Forcibly re-downloads missing artist images and covers.</span>
            </div>
            <button class="btn-action" on:click={() => runScan(true)} disabled={isScanning}>
                {isScanning ? 'Running Sweep...' : 'Hard Scan'}
            </button>
        </div>
    </div>

    <div class="settings-section danger-zone">
        <h2 style="color: #ef4444;">System</h2>
        
        <div class="setting-item-col">
            <div class="setting-info w-full" style="margin-bottom: 32px;">
                <span class="setting-title" style="color: #ef4444;">Force App Update</span>
                <span class="setting-desc mb-16">Purges logic caches and checks for a new version.</span>
                <button class="btn-refresh" on:click={refreshApp}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                    Refresh App
                </button>
            </div>

            <div class="setting-info w-full">
                <span class="setting-title" style="color: #ef4444;">Nuke Local Cache</span>
                <span class="setting-desc mb-16">Destroys Service Worker, Storage and Local Database.</span>
                <button class="btn-danger" on:click={nukeCache}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    Purge All Data
                </button>
            </div>
        </div>
    </div>
</div>

<style>
    .view-wrapper { padding: 32px 24px; max-width: 800px; margin: 0 auto; color: white; box-sizing: border-box; width: 100%; overflow-x: hidden; }
    .settings-header { margin-bottom: 40px; }
    .settings-header h1 { font-size: 32px; font-weight: 700; margin: 0; letter-spacing: -0.5px; }
    
    .settings-section { margin-bottom: 32px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    .danger-zone { border-color: rgba(239, 68, 68, 0.2); }
    .settings-section h2 { font-size: 14px; color: var(--accent-color); margin: 0 0 24px 0; text-transform: uppercase; letter-spacing: 1px; font-weight: 800; }
    
    .setting-item { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid rgba(255,255,255,0.05); gap: 16px; }
    .setting-item-col { display: flex; flex-direction: column; padding: 20px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .setting-item:last-child, .setting-item-col:last-child { border-bottom: none; padding-bottom: 0; }
    
    .setting-info { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
    .w-full { width: 100%; }
    .flex-between { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .setting-title { font-size: 16px; font-weight: 600; }
    .setting-desc { font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.5; }
    .mb-16 { margin-bottom: 16px; }
    .highlight-val { font-weight: 900; font-family: monospace; color: var(--accent-color); font-size: 16px; }
    
    .sleek-select { width: 100%; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); padding: 10px 12px; border-radius: 8px; font-size: 14px; font-weight: 600; outline: none; cursor: pointer; transition: border-color 0.2s ease, background 0.2s ease; }
    .sleek-select:hover { border-color: rgba(255,255,255,0.4); background: rgba(255,255,255,0.1); }
    .sleek-select option { background: #1a1a1a; color: white; font-weight: 500; }

    .segmented-control { display: flex; flex-shrink: 0; background: rgba(255,255,255,0.15); padding: 3px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05); flex-wrap: wrap; gap: 3px; }
    .segmented-control button { background: transparent; border: none; color: rgba(255,255,255,0.8); padding: 0 12px; height: 32px; font-size: 12px; font-weight: 800; cursor: pointer; border-radius: 6px; transition: all 0.2s; display: flex; align-items: center; justify-content: center; white-space: nowrap; flex-grow: 1; }
    .segmented-control button:hover { color: white; }
    .segmented-control button.active { background: var(--accent-color); color: black; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }

    .toggle-btn { width: 52px; height: 28px; border-radius: 14px; background: rgba(255,255,255,0.2); border: none; cursor: pointer; position: relative; transition: background 0.3s; padding: 0; flex-shrink: 0; }
    .toggle-btn.active { background: var(--accent-color); }
    .toggle-knob { width: 22px; height: 22px; border-radius: 50%; background: white; position: absolute; top: 3px; left: 3px; transition: transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1); box-shadow: 0 2px 6px rgba(0,0,0,0.3); }
    .toggle-btn.active .toggle-knob { transform: translateX(24px); }
    
    .range-slider { width: 100%; height: 6px; border-radius: 3px; -webkit-appearance: none; appearance: none; background: rgba(255,255,255,0.15); outline: none; }
    .range-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
    .range-slider::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: white; cursor: pointer; border: none; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }

    .btn-action { background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.1); color: white; padding: 8px 16px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; transition: all 0.2s; min-width: 100px; flex-shrink: 0; }
    .btn-action:hover:not(:disabled) { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.3); }
    .btn-action:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-refresh, .btn-danger { padding: 12px 24px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.5); border-radius: 24px; font-weight: 700; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s ease; width: fit-content; }
    .btn-refresh:hover, .btn-danger:hover { background: rgba(239, 68, 68, 0.2); border-color: #ef4444; }

    @media (max-width: 650px) {
        .setting-item { flex-direction: column; align-items: flex-start; gap: 16px; }
        .segmented-control { width: 100%; }
    }
</style>