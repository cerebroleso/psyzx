import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import fs from 'fs'
import path from 'path'

const certPath = '../../cachyos-x8664.tailb22187.ts.net.crt';
const keyPath  = '../../cachyos-x8664.tailb22187.ts.net.key';

console.log("--- Checking Certificate Files ---");
console.log("Full Path CRT:", path.resolve(certPath));
console.log("Exists?", fs.existsSync(certPath));
console.log("Full Path KEY:", path.resolve(keyPath));
console.log("Exists?", fs.existsSync(keyPath));

// Backend is plain HTTP on localhost — this is fine because:
// - Vite proxy <-> ASP.NET is loopback-only traffic (never leaves the machine)
// - Security is handled by Tailscale's WireGuard tunnel at the network layer
// - The HTTPS cert only needs to be on the Vite side for PWA/SW requirements
const backendTarget = 'http://localhost:5149';

const proxyConfig = {
  '/api': {
    target: backendTarget,
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
  },
  '/hubs': {
    target: backendTarget,
    changeOrigin: true,
    secure: false,
    ws: true,
  },
};

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
      host: 'cachyos-x8664.tailb22187.ts.net',
    },
    proxy: proxyConfig,
  },
  preview: {
    host: '0.0.0.0',
    https: {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    },
    proxy: proxyConfig,
  },
});