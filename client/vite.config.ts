import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The dev server proxies /api to the Fastify server (default port 3001, see .env.example).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Only the built app shell is cached. Financial data is never served from the cache, and
        // server routes are never answered with the SPA shell (the default fallback does that for any navigation).
        navigateFallbackDenylist: [/^\/api/],
      },
      manifest: {
        id: '/',
        lang: 'en',
        name: 'Wealth Manager',
        short_name: 'Wealth',
        description: 'Personal net worth tracker',
        theme_color: '#0b0614',
        background_color: '#0b0614',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Full-bleed artwork for Android adaptive icons (content stays in the safe zone)
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
