<script>
    import { currentUser } from '../../store.js';
    
    const handleLogout = async () => {
        await fetch('/api/Auth/logout', { method: 'POST' });
        window.location.hash = '';
        window.location.reload();
    };
</script>

<div class="account-container">
    <h1>My Account</h1>
    
    {#if $currentUser}
        <div class="user-card max-glass">
            <div class="avatar">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </div>
            <div class="info">
                <h2>{$currentUser.username}</h2>
                <span class="role">Role: {$currentUser.role}</span>
            </div>
        </div>
    {/if}

    <button class="btn-logout" on:click={handleLogout}>
        Logout
    </button>
</div>

<style>
    .account-container {
        padding: 32px;
        display: flex;
        flex-direction: column;
        gap: 32px;
        max-width: 600px;
    }

    h1 {
        color: white;
        margin: 0;
        font-weight: 800;
        letter-spacing: -0.5px;
    }

    .user-card {
        display: flex;
        align-items: center;
        gap: 24px;
        padding: 32px;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(32px) saturate(120%);
        -webkit-backdrop-filter: blur(32px) saturate(120%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 16px 40px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1);
    }

    .avatar {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: var(--accent-color);
        display: flex;
        align-items: center;
        justify-content: center;
        color: black;
        flex-shrink: 0;
    }

    .info h2 {
        color: white;
        margin: 0 0 8px 0;
        font-size: 24px;
    }

    .role {
        color: rgba(255,255,255,0.6);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
        font-weight: bold;
    }

    .btn-logout {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.3);
        padding: 16px 32px;
        border-radius: 12px;
        font-weight: bold;
        font-size: 16px;
        cursor: pointer;
        transition: all 0.2s;
        align-self: flex-start;
    }

    .btn-logout:hover {
        background: #ef4444;
        color: white;
        border-color: #ef4444;
        box-shadow: 0 8px 24px rgba(239, 68, 68, 0.3);
    }
</style>