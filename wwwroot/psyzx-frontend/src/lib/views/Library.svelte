<script>
    import { artistsMap, appSessionVersion, viewSize } from '../../store.js';
    import { onMount } from 'svelte';

    const DEFAULT_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
    const handleImageError = (ev) => {
        ev.target.src = DEFAULT_PLACEHOLDER;
    };
    
    $: artistsArray = Array.from($artistsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    let visibleCount = 40; // Start small so boot is instant
    $: visibleArtists = artistsArray.slice(0, visibleCount);

    let observerTarget;

    onMount(() => {
        // Set up the Intersection Observer
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                // When the invisible div hits the viewport, load 40 more
                if (visibleCount < artistsArray.length) {
                    visibleCount += 40;
                }
            }
        }, { rootMargin: '400px' }); // Load them 400px before the user even reaches the bottom

        if (observerTarget) observer.observe(observerTarget);

        return () => observer.disconnect();
    });

    const smoothLoad = (node) => {
        const trigger = () => {
            // Wait 50ms so the browser registers the opacity: 0 state first
            setTimeout(() => node.classList.add('loaded'), 50);
        };

        if (node.complete) {
            trigger(); // Already in cache
        } else {
            node.addEventListener('load', trigger); // Waiting for network
        }

        return {
            destroy() { node.removeEventListener('load', trigger); }
        };
    };

    const goArtist = (id) => {
        window.location.hash = `#artist/${id}`;
    };

    const updateViewSize = (size) => {
        viewSize.set(size);
        localStorage.setItem('psyzx_view_size', size);
    };
</script>

<div class="grid-container {$viewSize || 'medium'}">
    {#each visibleArtists as artist (artist.id)}
        <div class="card" role="button" tabindex="0" on:click={() => goArtist(artist.id)}>
            <img 
                use:smoothLoad
                src={artist.imagePath ? `/api/Tracks/image?path=${encodeURIComponent(artist.imagePath)}&size=thumb` : DEFAULT_PLACEHOLDER} 
                alt=""
                loading="lazy"
                decoding="async"
                class="sleek-cover"
                on:error={(e) => { 
                    handleImageError(e); 
                    setTimeout(() => e.target.classList.add('loaded'), 50);
                }}
            >
            <div class="card-title">{artist.name}</div>
        </div>
    {/each}
</div>

<div bind:this={observerTarget} style="height: 1px; width: 100%;"></div>

<style>
    /* Size Controls */
    .view-controls-wrapper {
        display: flex; justify-content: space-between; align-items: center;
        margin: 24px 0 16px 0; padding: 0 8px;
    }
    .section-title { margin: 0; font-size: 20px; font-weight: 700; color: white; }
    
    .segmented-control {
        display: flex; background: rgba(255,255,255,0.08); padding: 4px; border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.05);
    }
    .segmented-control button {
        background: transparent; border: none; color: white; width: 36px; height: 32px;
        font-size: 12px; font-weight: 800; cursor: pointer; border-radius: 6px;
        transition: all 0.2s; display: flex; align-items: center; justify-content: center;
    }
    .segmented-control button.active { background: var(--accent-color); color: black; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }

    .card {
    }

    .sleek-cover {
        width: 100%;
        height: 100%;
        object-fit: cover;
        opacity: 0;
        transform: scale(0.92);
        filter: blur(10px);
        /* The magic physics curve */
        transition: 
            opacity 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
            transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1),
            filter 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
        will-change: transform, opacity, filter;
    }

    /* Final state: Visible, actual size, and sharp */
    .sleek-cover.loaded {
        opacity: 1;
        transform: scale(1);
        filter: blur(0);
    }
</style>