import { mount } from 'svelte';
import './app.css'; 
// @ts-ignore
import App from './App.svelte';

// ── SERVICE WORKER REGISTRATION ──
// Robust registration that handles iOS Safari PWA edge cases:
// - Waits for `load` event to avoid competing with critical resource loading
// - Uses `navigator.serviceWorker.ready` for reliable controller availability
// - Graceful update handling (no hard reloads that can cause iOS white screen)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(reg => {
                console.log('✅ [SW] Registered:', reg.scope);
                
                reg.onupdatefound = () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;
                    
                    newWorker.onstatechange = () => {
                        if (newWorker.state === 'activated') {
                            // New SW is active. On next navigation/refresh the 
                            // user will get the new version. Don't force reload
                            // here — it causes white screen on iOS Safari PWA.
                            console.log('🔄 [SW] New version activated. Refresh to update.');
                        }
                    };
                };
            })
            .catch(err => {
                console.error('❌ [SW] Registration failed:', err);
            });

        // Ensure the SW takes control of this page ASAP.
        // Critical for first install: without this, the page has no 
        // active controller until a navigation/refresh.
        navigator.serviceWorker.ready.then(reg => {
            if (!navigator.serviceWorker.controller) {
                // First install — the SW called skipWaiting+claim but this 
                // page loaded before the SW was ready. Reload once.
                console.log('⏳ [SW] First install detected, reloading for control...');
                // Small delay to let the SW finish activating
                setTimeout(() => location.reload(), 500);
            }
        });
    });
} else {
    console.warn('⚠️ [SW] Service workers not supported.');
}

const app = mount(App, {
    target: document.getElementById('app'),
});

export default app;