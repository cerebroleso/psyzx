<script>
    import { onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    import { isGlobalColorActive, isMaxGlassActive, isDesktopSwapActive } from '../../store.js';
    import { setVolumeBoost } from '../audio.js';

    let currentBoost = '1.0';

    onMount(() => {
        currentBoost = localStorage.getItem('psyzx_boost') || '1.0';
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

    const nukeCache = async () => {
        if (confirm('Sei sicuro? Cancellerai tutti i brani scaricati offline e verrai sloggato.')) {
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
        <h1>Impostazioni</h1>
    </div>

    <div class="settings-section">
        <h2>Aspetto & UI</h2>
        
        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Sfondo Globale Dinamico</span>
                <span class="setting-desc">Applica il colore della canzone in riproduzione allo sfondo di tutta l'app.</span>
            </div>
            <button class="toggle-btn" class:active={$isGlobalColorActive} on:click={toggleGlobalColor} aria-label="Toggle Global Background">
                <div class="toggle-knob"></div>
            </button>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Max Glassmorphism</span>
                <span class="setting-desc">Attiva un effetto di sfocatura estremo in stile iOS per la status bar e crea una capsula dedicata per il brano.</span>
            </div>
            <button class="toggle-btn" class:active={$isMaxGlassActive} on:click={toggleMaxGlass} aria-label="Toggle Max Glass">
                <div class="toggle-knob"></div>
            </button>
        </div>

        <div class="setting-item">
            <div class="setting-info">
                <span class="setting-title">Inverti Layout Status Bar (Desktop)</span>
                <span class="setting-desc">Sposta le info della canzone a destra e i controlli del volume/bitrate a sinistra.</span>
            </div>
            <button class="toggle-btn" class:active={$isDesktopSwapActive} on:click={toggleDesktopSwap} aria-label="Toggle Layout Swap">
                <div class="toggle-knob"></div>
            </button>
        </div>
    </div>

    <div class="settings-section">
        <h2>Hardware Pre-Amp</h2>
        
        <div class="setting-item-col">
            <div class="setting-info w-full">
                <div class="flex-between">
                    <span class="setting-title">Gain Multiplier</span>
                    <span class="highlight-val">{currentBoost}x</span>
                </div>
                <span class="setting-desc mb-16">Aumenta il guadagno hardware del player in locale. Bypassa i limiti del server.</span>
            </div>
            <input class="range-slider" type="range" min="0.5" max="3.0" step="0.1" value={currentBoost} on:input={updateBoost}>
        </div>
    </div>

    <div class="settings-section danger-zone">
        <h2 style="color: #ef4444;">Nuke Local Cache</h2>
        
        <div class="setting-item-col">
            <div class="setting-info w-full">
                <span class="setting-desc mb-16">Distrugge Service Worker, Storage e Database locale. Usare solo in caso di emergenza.</span>
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
    .setting-info { display: flex; flex-direction: column; gap: 6px; max-width: 80%; }
    .w-full { max-width: 100%; width: 100%; }
    .flex-between { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .setting-title { font-size: 16px; font-weight: 600; }
    .setting-desc { font-size: 13px; color: rgba(255,255,255,0.5); line-height: 1.5; }
    .mb-16 { margin-bottom: 16px; }
    .highlight-val { font-weight: 900; font-family: monospace; color: var(--accent-color); font-size: 16px; }
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
    .btn-danger {
        padding: 12px 24px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.5); 
        border-radius: 24px; font-weight: 700; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; 
        gap: 8px; transition: all 0.2s ease; width: fit-content;
    }
    .btn-danger:hover { background: rgba(239, 68, 68, 0.2); border-color: #ef4444; transform: translateY(-2px); }
</style>