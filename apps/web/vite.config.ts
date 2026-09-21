import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The API dev server (port 3002) needs a few seconds longer to boot than Vite does, so the
 * app's first `/api/*` calls land while nothing is listening yet. Left alone, Vite logs a
 * red `http proxy error … ECONNREFUSED` with a full stack trace for each one, on every
 * startup. Swap its error handler for one that stays quiet about "still booting"
 * (ECONNREFUSED / ECONNRESET) — answering those with a 503 the client simply retries — and
 * still reports any other proxy failure.
 */
const quietWhileApiBoots: ProxyOptions['configure'] = (proxy) => {
  let warned = false;
  // Runs after Vite has attached its own 'error' listener a tick from now.
  process.nextTick(() => {
    proxy.removeAllListeners('error');
    proxy.on('error', (err: NodeJS.ErrnoException, _req, res) => {
      const booting = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET';
      if (booting) {
        if (!warned) {
          console.log('  \x1b[2m[proxy] API on :3002 not up yet — retrying once it boots\x1b[0m');
          warned = true;
        }
      } else {
        console.error(`[proxy] ${err.message}`);
      }
      if ('writeHead' in res && !res.headersSent) {
        res.writeHead(booting ? 503 : 502, { 'Content-Type': 'text/plain' });
        res.end(booting ? 'API starting' : 'Proxy error');
      } else if ('end' in res) {
        res.end();
      }
    });
  });
};

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
        configure: quietWhileApiBoots,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Each page is its own lazy-loaded chunk (see App.tsx). What is left past the 500 kB
    // default is antd's shared component chunk (~610 kB) — every page uses several of its
    // components, so this is baseline cost, not something one route is dragging in by
    // accident. Raised just past that rather than disabled outright, so a genuinely
    // oversized future chunk still warns.
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      onwarn(warning, warn) {
        // `demo-client.ts` (the client-side demo build's data layer) reaches `db/schema.ts`
        // for `defineSchema`, which lives in the same module as repolayer's `createRepo` —
        // whose SQLite/Postgres/MySQL drivers it only reaches through `await import(...)`.
        // Rolldown still resolves those adapter modules to build the graph, sees their real
        // `node:*` imports, and warns, even though nothing in this app ever calls
        // `createRepo` in the browser (only `defineSchema` and the in-memory driver — see
        // `demo-client.ts`'s header). Tree-shaking then drops the whole unreachable branch,
        // so nothing Node-only actually ships; verified by grepping `dist/assets/*.js` for
        // `createRepo`/`SqliteRepo`/`openSqlite`, all absent. Safe to silence.
        if (warning.message.includes('has been externalized for browser compatibility')) return;
        warn(warning);
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
