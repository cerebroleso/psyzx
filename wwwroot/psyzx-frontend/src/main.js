import { mount } from 'svelte';
import './app.css'; 
// @ts-ignore
import App from './App.svelte';

// VERBOSE SERVICE WORKER REGISTRATION (Aiuta a debuggare)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(reg => {
                console.log('✅ [SW] Successfully registered!', reg.scope);
            })
            .catch(err => {
                console.error('❌ [SW] Registration failed. Assicurati che sw.js sia dentro la cartella /public', err);
            });
    });
} else {
    console.warn('⚠️ [SW] Service workers are not supported in this browser.');
}

const app = mount(App, {
    target: document.getElementById('app'),
});

export default app;