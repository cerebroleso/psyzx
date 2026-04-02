<script>
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();

    export let isScrolled = false;
    export let navContext = 'Library';
    export let currentHash = ''; // <-- ECCO IL COLPEVOLE MANCANTE!
    
    let searchQuery = '';

    const handleSearch = () => {
        if (searchQuery.trim().length > 0) {
            window.location.hash = `#search/${encodeURIComponent(searchQuery.trim())}`;
        } else {
            window.location.hash = '';
        }
    };
</script>

<header id="topbar" class:scrolled={isScrolled}>
    <button class="btn-icon mobile-only" aria-label="Menu" style="margin-right: 12px;" on:click={() => dispatch('toggleSidebar')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
    </button>
    
    <button id="btn-back" aria-label="Go Back" disabled={currentHash === '' || currentHash === '#'} on:click={() => window.history.back()}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"></path></svg>
    </button>
    
    <div id="nav-context" style="white-space: nowrap; margin-right: auto; margin-left: 8px;">
        {navContext}
    </div>
    
    <button class="btn-icon" aria-label="Refresh" style="margin-right: 8px; color: var(--text-primary);" title="Refresh Library" on:click={() => dispatch('refresh')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
    </button>
    
    <div class="search-container">
        <input type="text" id="search-input" placeholder="Search..." bind:value={searchQuery} on:input={handleSearch}>
    </div>
</header>