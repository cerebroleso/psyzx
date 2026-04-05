import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import fs from 'fs'
import path from 'path'

// --- DIAGNOSTIC LOGS ---
const certPath = '../../cachyos-x8664.tailb22187.ts.net.crt';
const keyPath = '../../cachyos-x8664.tailb22187.ts.net.key';

console.log("--- Checking Certificate Files ---");
console.log("Full Path CRT:", path.resolve(certPath));
console.log("Exists?", fs.existsSync(certPath));
console.log("Full Path KEY:", path.resolve(keyPath));
console.log("Exists?", fs.existsSync(keyPath));
// -----------------------

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: '0.0.0.0', 
    https: {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    },
    hmr: {
      protocol: 'wss',
      // CRITICAL: Match the certificate domain
      host: 'cachyos-x8664.tailb22187.ts.net', 
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5149',
        changeOrigin: true,
        secure: false,
        cookieDomainRewrite: "", 
        xfwd: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['Access-Control-Allow-Origin'] = '*';
            proxyRes.headers['Access-Control-Allow-Credentials'] = 'true';
          });
        }
      }
    }
  }
})