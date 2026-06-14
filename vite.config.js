import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'favicon.svg'],
      manifest: {
        name: 'Bluesky Manager',
        short_name: 'BskyMgr',
        description:
          'Manage your Bluesky account and mass-follow users via the AT Protocol.',
        theme_color: '#1d9bf0',
        background_color: '#0f1419',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell precache; API calls (bsky.social) are never cached.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallbackDenylist: [/^\/xrpc/],
      },
    }),
  ],
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
