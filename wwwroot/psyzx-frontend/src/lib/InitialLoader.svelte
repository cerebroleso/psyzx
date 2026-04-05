<script>
    import { onMount, onDestroy } from 'svelte';
    import { fade, fly } from 'svelte/transition';
    
    export let progress = 0; 
    export let status = "";

    let barRef;
    let displayPct = 0;
    let rafId;

    const lerp = (start, end, amt) => (1 - amt) * start + amt * end;

    const renderLoop = () => {
        // SAFETY: Fallback to 0 if progress is undefined/null
        const target = typeof progress === 'number' ? progress : 0;

        // displayPct chases 'target' with organic easing
        // 0.05 = Buttery slow / 0.1 = Snappy smooth
        displayPct = lerp(displayPct, target, 0.06);

        if (barRef) {
            // scaleX(0) = empty, scaleX(1) = full
            // Dividing by 100 because the input is 0-100
            barRef.style.transform = `scaleX(${displayPct / 100})`;
        }
        
        rafId = requestAnimationFrame(renderLoop);
    };

    onMount(() => {
        rafId = requestAnimationFrame(renderLoop);
    });

    onDestroy(() => {
        if (rafId) cancelAnimationFrame(rafId);
    });
</script>

<div class="boot-container" out:fade={{ duration: 600 }}>
    <div class="boot-content" in:fly={{ y: 20, duration: 800 }}>
        <div class="logo-area">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="boot-icon">
                <path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>
            </svg>
            <h1>PSYZX<span>MUSIC</span></h1>
        </div>

        <div class="progress-wrapper">
            <div class="progress-bar">
                <div class="progress-fill" bind:this={barRef}></div>
            </div>
            <div class="status-text">{status}</div>
        </div>
    </div>
</div>

<style>
    .boot-container {
        position: fixed; 
        inset: 0; 
        /* Ultra-high z-index to stay above dynamic backgrounds */
        z-index: 9999999;
        background: #050505; 
        display: flex;
        align-items: center; 
        justify-content: center;
    }

    .boot-content { 
        width: 100%; 
        max-width: 400px; 
        text-align: center; 
        padding: 20px; 
    }
    
    .boot-icon {
        color: var(--accent-color, #b534d1);
        margin-bottom: 16px;
        filter: drop-shadow(0 0 15px rgba(181, 52, 209, 0.4));
    }

    h1 { 
        color: white; 
        font-size: 24px; 
        font-weight: 900; 
        letter-spacing: 4px; 
        margin: 0; 
    }

    h1 span { 
        color: rgba(255,255,255,0.3); 
        font-weight: 300; 
    }

    .progress-bar {
        width: 100%; 
        height: 4px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px; 
        overflow: hidden; 
        margin-bottom: 4px;
        position: relative;
    }

    .progress-fill {
        position: absolute; 
        top: 0; 
        left: 0;
        width: 100%; 
        height: 100%;
        background: linear-gradient(90deg, #7c22d3, #b534d1);
        box-shadow: 0 0 20px rgba(181, 52, 209, 0.6);
        
        /* Direct control via transform for GPU performance */
        transform-origin: left;
        will-change: transform;
        transform: scaleX(0);
    }

    .status-text {
        font-family: monospace; 
        font-size: 10px;
        color: rgba(255, 255, 255, 0.4);
        text-transform: uppercase; 
        letter-spacing: 2px;
        /* Keep text width stable during updates */
        font-variant-numeric: tabular-nums;
    }
</style>