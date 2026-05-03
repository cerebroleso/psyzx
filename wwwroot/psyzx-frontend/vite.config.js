import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import fs from 'fs'
import path from 'path'

const certPath = '../../server.crt';
const keyPath  = '../../server.key';

const getHttpsConfig = () => {
  const hasCert = fs.existsSync(certPath);
  const hasKey = fs.existsSync(keyPath);

  if (hasCert && hasKey) {
    console.log("✅ SSL Certificates (server.crt/key) located. HTTPS Enabled.");
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  }
  
  console.warn("⚠️  SSL Certificates NOT FOUND at:");
  console.warn("   CRT:", path.resolve(certPath));
  console.warn("   KEY:", path.resolve(keyPath));
  console.warn("--- Falling back to plain HTTP ---");
  return false;
};

const backendTarget = 'http://localhost:5149';

const proxyConfig = {
  '/api': {
    target: backendTarget,
    changeOrigin: true,
    secure: false,
    xfwd: true,
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
  build: {
    // SAFE: Builds to local 'dist' folder to avoid nuking source code
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    https: getHttpsConfig(),
    hmr: {
      protocol: 'wss',
      host: 'cachyos-x8664.tailb22187.ts.net',
    },
    proxy: proxyConfig,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    // CRITICAL: This prevents the RX_RECORD_TOO_LONG error in preview mode
    https: getHttpsConfig(),
    proxy: proxyConfig,
  },
});