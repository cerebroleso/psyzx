<script>
    import { fade } from 'svelte/transition';
    import { createEventDispatcher } from 'svelte';
    import { api } from '../api.js';

    export let isLoggingIn = false;
    let isRegisterMode = false;
    let loginUsername = '';
    let loginPassword = '';
    let loginErrorMsg = '';

    const dispatch = createEventDispatcher();

    const executeAuth = async () => {
        console.group(`[AUTH DEBUG] executeAuth() - Mode: ${isRegisterMode ? 'REGISTER' : 'LOGIN'}`);
        
        const trimmedUsername = loginUsername.trim();
        console.log(`[AUTH DEBUG] Raw Input -> User: "${loginUsername}", Trimmed: "${trimmedUsername}", Password Length: ${loginPassword.length}`);

        if (!trimmedUsername || !loginPassword) {
            console.warn('[AUTH DEBUG] Validation failed: Empty fields detected after trim.');
            loginErrorMsg = "Fill all fields.";
            console.groupEnd();
            return;
        }
        
        isLoggingIn = true;
        loginErrorMsg = '';
        
        const credentials = { username: trimmedUsername, password: loginPassword };

        try {
            if (isRegisterMode) {
                console.log('[AUTH DEBUG] Calling api.register...');
                const res = await api.register(credentials);
                
                if (res && (res.ok === true || res.success === true || res.status === 200 || res.status === 201)) {
                    console.log('[AUTH DEBUG] Registration SUCCESS. Switching to login mode to auto-auth.');
                    isRegisterMode = false;
                    console.groupEnd();
                    await executeAuth();
                } else {
                    let errorText = "Username already taken or server error.";
                    if (res && typeof res.json === 'function') {
                        try {
                            const errData = await res.clone().json();
                            errorText = errData.message || errData.error || errorText;
                        } catch (e) {}
                    } else if (res && res.message) {
                        errorText = res.message;
                    }

                    loginErrorMsg = errorText;
                    isLoggingIn = false;
                    console.groupEnd();
                }
            } else {
                console.log('[AUTH DEBUG] Calling api.login...');
                const res = await api.login(credentials);

                if (res && (res.ok === true || res.success === true || res.token || res.status === 200)) {
                    console.log('[AUTH DEBUG] Login SUCCESS! Transitioning app state...');
                    isLoggingIn = false;
                    dispatch('success');
                    console.groupEnd();
                } else {
                    console.error('[AUTH DEBUG] Login FAILED. Denied by server.');
                    let errorText = "Invalid credentials. Retry.";
                    
                    if (res && typeof res.json === 'function') {
                        try {
                            const errData = await res.clone().json();
                            errorText = errData.message || errData.error || errorText;
                        } catch (e) {}
                    } else if (res && res.message) {
                        errorText = res.message;
                    }

                    loginErrorMsg = errorText;
                    isLoggingIn = false;
                    console.groupEnd();
                }
            }
        } catch (error) {
            console.error('[AUTH DEBUG] FATAL EXCEPTION during authentication API call:', error);
            loginErrorMsg = "A network or server error occurred.";
            isLoggingIn = false;
            console.groupEnd();
        }
    };
</script>

<div class="auth-overlay" in:fade={{duration: 300}}>
    <div class="auth-card">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <h2>{isRegisterMode ? 'Create Account' : 'Access Required'}</h2>
        
        <form on:submit|preventDefault={executeAuth} class="auth-form">
            <input type="text" bind:value={loginUsername} placeholder="Username" required disabled={isLoggingIn} autocomplete="username">
            <input type="password" bind:value={loginPassword} placeholder="Password" required disabled={isLoggingIn} autocomplete={isRegisterMode ? "new-password" : "current-password"}>
            
            {#if loginErrorMsg}
                <div class="auth-error">{loginErrorMsg}</div>
            {/if}
            
            <button type="submit" class="btn-auth" disabled={isLoggingIn}>
                {#if isLoggingIn}
                    Working...
                {:else}
                    {isRegisterMode ? 'Sign Up' : 'Enter'}
                {/if}
            </button>
        </form>

        <button class="btn-toggle-auth" on:click={() => { isRegisterMode = !isRegisterMode; loginErrorMsg = ''; }} disabled={isLoggingIn}>
            {isRegisterMode ? 'Already have an account? Login' : 'No account? Register here'}
        </button>
    </div>
</div>

<style>
    /* OVERLAY SCURO E BLURRATO PER IL LOGIN */
    .auth-overlay {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.6); 
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        z-index: 999999;
        perspective: 1000px;
    }

    /* CARD LOGIN ULTRA-GLASS */
    .auth-card {
        background: rgba(255, 255, 255, 0.03);
        backdrop-filter: blur(40px) saturate(150%);
        -webkit-backdrop-filter: blur(40px) saturate(150%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-top: 1px solid rgba(255, 255, 255, 0.25);
        padding: 48px 40px; 
        border-radius: 28px; 
        text-align: center; 
        width: 90%;
        max-width: 420px;
        box-shadow: 
            0 32px 64px rgba(0, 0, 0, 0.5), 
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        transform: translateY(0);
        animation: cardFloatUp 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
    }

    @keyframes cardFloatUp {
        0% { opacity: 0; transform: translateY(30px) scale(0.95); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
    }

    .auth-card h2 { 
        margin: 0 0 32px 0; 
        font-size: 28px; 
        color: white; 
        font-weight: 800;
        letter-spacing: -1px;
    }

    .auth-form { 
        display: flex; 
        flex-direction: column; 
        gap: 16px; 
    }

    .auth-form input {
        width: 100%; 
        padding: 16px 20px; 
        background: rgba(0, 0, 0, 0.3); 
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.05); 
        border-radius: 16px; 
        font-size: 15px;
        box-sizing: border-box; 
        outline: none; 
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
    }

    .auth-form input::placeholder {
        color: rgba(255, 255, 255, 0.3);
    }

    .auth-form input:focus { 
        border-color: var(--accent-color); 
        background: rgba(0, 0, 0, 0.5);
        box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1), inset 0 2px 4px rgba(0,0,0,0.2); 
    }
    
    .auth-form input:disabled { 
        opacity: 0.5; 
        cursor: not-allowed; 
    }

    .auth-error { 
        color: #ef4444; 
        font-size: 13px; 
        font-weight: 700; 
        margin-top: -4px; 
        background: rgba(239, 68, 68, 0.1);
        padding: 10px;
        border-radius: 10px;
        border: 1px solid rgba(239, 68, 68, 0.2);
    }

    .btn-auth {
        background: var(--accent-color); 
        color: black; 
        border: none; 
        padding: 16px;
        font-size: 16px; 
        font-weight: 800; 
        border-radius: 16px; 
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
        width: 100%; 
        margin-top: 8px;
    }

    .btn-auth:hover:not(:disabled) { 
        transform: translateY(-2px); 
        box-shadow: 0 8px 24px rgba(255, 255, 255, 0.2);
        filter: brightness(1.15);
    }
    
    .btn-auth:active:not(:disabled) {
        transform: translateY(1px);
        box-shadow: 0 2px 8px rgba(255, 255, 255, 0.1);
    }

    .btn-auth:disabled { 
        opacity: 0.7; 
        cursor: wait; 
        filter: grayscale(0.5);
    }

    .btn-toggle-auth {
        background: none; 
        border: none; 
        color: rgba(255, 255, 255, 0.4);
        margin-top: 24px; 
        cursor: pointer; 
        font-size: 14px; 
        font-weight: 600;
        transition: all 0.2s;
    }

    .btn-toggle-auth:hover { 
        color: white; 
        text-shadow: 0 0 12px rgba(255,255,255,0.4);
    }
</style>
