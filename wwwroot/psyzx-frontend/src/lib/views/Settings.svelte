<script>
    import { onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    import { isGlobalColorActive, isMaxGlassActive, isDesktopSwapActive, viewSize, isCacheDebugActive } from '../../store.js';
    import { setVolumeBoost } from '../audio.js';

    let currentBoost = '1.0';
    let isGaplessEnabled = true;

    onMount(() => {
        currentBoost = localStorage.getItem('psyzx_boost') || '1.0';
        isGaplessEnabled = localStorage.getItem('psyzx_gapless') !== 'false';
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_DEBUG_MODE',
                value: $isCacheDebugActive
            });
        }
    });

    const updateBoost = (e) => {
        const val = parseFloat(e.target.value).toFixed(1);
        currentBoost = val;
        localStorage.setItem('psyzx_boost', val);
        setVolumeBoost(val);
    };

    const toggleGlobalColor = () => isGlobalColorActive.set(!$isGlobalColorActive);
    const toggleMaxGlass = () => isMaxGlassActive.set(!$isMaxGlassActive);
    const toggleDesktopSwap = () => isDesktopSwapActive.set(!$isDesktopSwapActive);
    
    const updateViewSize = (size) => {
        viewSize.set(size);
        localStorage.setItem('psyzx_view_size', size);
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

    const toggleGapless = () => {
        isGaplessEnabled = !isGaplessEnabled;
        localStorage.setItem('psyzx_gapless', isGaplessEnabled.toString());
    };

    const refreshApp = async () => {
        try {
            const keys = await caches.keys();
            await Promise.all(
                keys.filter(key => key.includes('core')).map(key => caches.delete(key))
            );

            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (let reg of regs) await reg.unregister();
            }
            
            window.location.reload();
        } catch (e) {
            console.error(e);
            window.location.reload();
        }
    };

    const nukeCache = async () => {
        if (confirm('Are you sure? This will delete all cached tracks and settings.')) {
            localStorage.clear();
            try {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (let reg of regs) await reg.unregister();
                }
            } catch(e) {}
            window.location.reload();
        }
    };
</script>

<div class="view-wrapper" in:fade={{duration: 200}}>
    <div class="settings-header">
        <h1>Settings</h1>
    </div>

    <div class="settings-section">
        <h2>UI & Look</h2>
        
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
                <span class="setting-desc">Applies the color of the active album for the entire app's background.</span>
            </div>
            <button class="toggle-btn" class:active={$isGlobalColorActive} on:click={toggleGlobalColor} aria-label="Toggle Global Background">
                <div class="toggle-knob"></div>
            </button>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Max Glassmorphism</span>
                <span class="setting-desc">Enables glassmorphism (IOS 26).</span>
            </div>
            <button class="toggle-btn" class:active={$isMaxGlassActive} on:click={toggleMaxGlass} aria-label="Toggle Max Glass">
                <div class="toggle-knob"></div>
            </button>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Invert Status Bar Layout (Desktop)</span>
                <span class="setting-desc">Moves track's info to the right and volume/bitrate controls to the left.</span>
            </div>
            <button class="toggle-btn" class:active={$isDesktopSwapActive} on:click={toggleDesktopSwap} aria-label="Toggle Layout Swap">
                <div class="toggle-knob"></div>
            </button>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Developer: Bypass Cache</span>
                <span class="setting-desc">Disables aggressive caching. Use this if you are editing CSS/JS and don't see changes.</span>
            </div>
            <button class="toggle-btn" class:active={$isCacheDebugActive} on:click={toggleCacheDebug} aria-label="Toggle Cache Debug">
                <div class="toggle-knob"></div>
            </button>
        </div>
    </div>

    <div class="settings-section">
        <h2>Audio Engine</h2>
        
        <div class="setting-item" style="margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 24px;">
            <div class="setting-info">
                <span class="setting-title">Gapless Playback</span>
                <span class="setting-desc">Preloads and primes the next track for seamless audio transitions. Optimized for iOS.</span>
            </div>
            <button class="toggle-btn" class:active={isGaplessEnabled} on:click={toggleGapless} aria-label="Toggle Gapless Playback">
                <div class="toggle-knob"></div>
            </button>
        </div>

        <div class="setting-item-col">
            <div class="setting-info w-full">
                <div class="flex-between">
                    <span class="setting-title">Gain Multiplier</span>
                    <span class="highlight-val">{currentBoost}x</span>
                </div>
                <span class="setting-desc mb-16">Increases the gain of the local player (up to 3x).</span>
            </div>
            <input class="range-slider" type="range" min="0.5" max="3.0" step="0.1" value={currentBoost} on:input={updateBoost}>
        </div>
    </div>

    <div class="settings-section danger-zone">
        <h2 style="color: #ef4444;">System</h2>
        
        <div class="setting-item-col">
            <div class="setting-info w-full">
                <span class="setting-title" style="color: #ef4444;">Force App Update</span>
                <span class="setting-desc mb-16">Purges JS/CSS/HTML and checks for a new version. Fixes iOS PWA "freeze". Your music stays safe.</span>
                <button class="btn-refresh" on:click={refreshApp}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                    Refresh App
                </button>
            </div>
        </div>

        <div class="setting-item-col" style="margin-top: 24px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 24px;">
            <div class="setting-info w-full">
                <span class="setting-title" style="color: #ef4444;">Nuke Local Cache</span>
                <span class="setting-desc mb-16">Destroys Service Worker, Storage and Local Database. Use only as a last resort.</span>
                <button class="btn-danger" on:click={nukeCache}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    Purge All Data
                </button>
            </div>
        </div>
    </div>
</div>

<style>
    .view-wrapper { padding: 32px 24px; max-width: 800px; margin: 0 auto; color: white; }
    .settings-header { margin-bottom: 40px; }
    .settings-header h1 { font-size: 32px; font-weight: 700; margin: 0; letter-spacing: -0.5px; }
    
    .settings-section { 
        margin-bottom: 32px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); 
        border-radius: 12px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    }
    
    .danger-zone { border-color: rgba(239, 68, 68, 0.2); }
    .settings-section h2 { font-size: 14px; color: var(--accent-color); margin: 0 0 24px 0; text-transform: uppercase; letter-spacing: 1px; font-weight: 800; }
    
    .setting-item { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .setting-item-col { display: flex; flex-direction: column; padding: 16px 0; }
    .setting-item:last-child, .setting-item-col:last-child { border-bottom: none; padding-bottom: 0; }
    
    .setting-info { display: flex; flex-direction: column; gap: 6px; }
    .setting-info:not(.w-full) { max-width: 60%; }
    .w-full { width: 100%; }
    
    .flex-between { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .setting-title { font-size: 16px; font-weight: 600; }
    .setting-desc { font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.5;}
    .mb-16 { margin-bottom: 16px; }
    .highlight-val { font-weight: 900; font-family: monospace; color: var(--accent-color); font-size: 16px; }
    
    .segmented-control {
        display: flex; background: rgba(255,255,255,0.15); padding: 2px; border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.05);
        margin-left: 10px;
    }
    .segmented-control button {
        background: transparent; border: none; color: white; width: 36px; height: 32px;
        font-size: 12px; font-weight: 800; cursor: pointer; border-radius: 6px;
        transition: all 0.2s; display: flex; align-items: center; justify-content: center;
    }
    .segmented-control button.active { background: var(--accent-color); color: black; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }

    .toggle-btn {
        width: 52px; height: 28px; border-radius: 14px; background: rgba(255,255,255,0.2); border: none;
        cursor: pointer; position: relative; transition: background 0.3s; padding: 0; flex-shrink: 0;
    }
    .toggle-btn.active { background: var(--accent-color); }
    .toggle-knob {
        width: 22px; height: 22px; border-radius: 50%; background: white;
        position: absolute; top: 3px; left: 3px; transition: transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .toggle-btn.active .toggle-knob { transform: translateX(24px); }
    
    .range-slider {
        width: 100%; height: 6px; border-radius: 3px; -webkit-appearance: none; appearance: none;
        background: rgba(255,255,255,0.15); outline: none;
    }
    .range-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
    .range-slider::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: white; cursor: pointer; border: none; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }

    .btn-refresh, .btn-danger {
        padding: 12px 24px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.5); 
        border-radius: 24px; font-weight: 700; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; 
        gap: 8px; transition: all 0.2s ease; width: fit-content;
    }
    .btn-refresh:hover, .btn-danger:hover { background: rgba(239, 68, 68, 0.2); border-color: #ef4444; }
</style>