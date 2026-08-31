import { resolve } from 'node:path';

const here = import.meta.dirname;
import { defineConfig } from 'vite';

/**
 * Two HTML entry points, and `public/` (the manifest and the icons) copied verbatim.
 *
 * No hashed filenames: an unpacked extension is reloaded in place during development, and
 * stable names keep a diff of `dist/` readable. Nothing here is cached by a CDN, so the
 * usual reason for hashing does not apply.
 */
export default defineConfig({
  root: here,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(here, 'popup.html'),
        options: resolve(here, 'options.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
