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
    /**
     * No `<link rel="modulepreload">`.
     *
     * Vite emits one for every shared chunk — here `chunks/settings.js`, which both the
     * popup and the options page import — with a `crossorigin` attribute. Chrome then logs
     * two warnings per page: the preload is a "cross-world extension resource mismatch"
     * (the preload and the module graph's own fetch are not the same request, so the
     * preloaded copy is thrown away), followed by the generic "preloaded but not used
     * within a few seconds" for the copy nobody claimed.
     *
     * The tag buys nothing to begin with. Preloading hides *network* latency, and these
     * files are already on disk inside the extension — the module graph loads the chunk on
     * its own either way.
     */
    modulePreload: false,
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
