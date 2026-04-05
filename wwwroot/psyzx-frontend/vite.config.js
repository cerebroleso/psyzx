import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [svelte(), basicSsl()],
  server: {
    host: true,
    allowedHosts: true,
    https: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5149',
        changeOrigin: true,
        secure: false,
        // QUESE DUE RIGHE SONO MAGIA NERA PER L'AUTH
        cookieDomainRewrite: "", // Rimuove restrizioni di dominio dai cookie di ASP.NET
        xfwd: true, // Invia gli header reali (IP, protocollo) al C#
        configure: (proxy, options) => {
          proxy.on('proxyRes', (proxyRes, req, res) => {
            proxyRes.headers['Access-Control-Allow-Origin'] = '*';
            proxyRes.headers['Access-Control-Allow-Credentials'] = 'true'; // Fondamentale se usi Auth!
          });
        }
      }
    }
  }
})