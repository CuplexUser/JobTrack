import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Set by the GitHub Pages workflow for a project page served from a subpath
  // (`https://<user>.github.io/<repo>/`); unset (root `/`) for local builds, previews, and
  // a Vercel/user-page deployment, which are served from their own domain root.
  base: process.env.GITHUB_PAGES_BASE ?? '/',
  server: {
    port: 5173,
    // Same-origin in development, so the browser never deals with CORS and the API can
    // stay bound to localhost. Port 3002, not the API's usual 3001, so `npm run dev` can
    // run alongside a `tray`/prod instance without a port clash (see dev:api's PORT
    // override in the root package.json).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
