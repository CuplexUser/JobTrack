import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error -- a plain ES module shared with scripts/package.mjs, which has no types.
import { buildManifest } from './scripts/manifest.mjs';

const here = import.meta.dirname;

/**
 * Writes `dist/manifest.json` from `scripts/manifest.mjs`, with the version from package.json.
 * This is the Chromium flavor, for loading `dist/` unpacked while developing;
 * `scripts/package.mjs` writes the Firefox one when packaging a release.
 */
function manifest(): Plugin {
  return {
    name: 'jobtrack-manifest',
    generateBundle() {
      const { version } = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as { version: string };
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(buildManifest('chromium', version), null, 2)}\n`,
      });
    },
  };
}

/**
 * Two HTML entry points, `public/` (the icons) copied verbatim, and the manifest generated.
 *
 * No hashed filenames: an unpacked extension is reloaded in place during development, and
 * stable names keep a diff of `dist/` readable. Nothing here is cached by a CDN, so the
 * usual reason for hashing does not apply.
 */
export default defineConfig({
  root: here,
  plugins: [manifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    /**
     * Readable output. Mozilla reviews what it signs, and code a reviewer can read without the
     * source archive is code that gets through review faster. The extension is a few
     * kilobytes loaded from disk, so minifying buys nothing.
     */
    minify: false,
    /**
     * No `<link rel="modulepreload">`.
     *
     * Vite emits one for every shared chunk (here `chunks/settings.js`, which both the
     * popup and the options page import) with a `crossorigin` attribute. Chrome then logs
     * two warnings per page: the preload is a "cross-world extension resource mismatch"
     * (the preload and the module graph's own fetch are not the same request, so the
     * preloaded copy is thrown away), followed by the generic "preloaded but not used
     * within a few seconds" for the copy nobody claimed.
     *
     * The tag buys nothing to begin with. Preloading hides *network* latency, and these
     * files are already on disk inside the extension; the module graph loads the chunk on
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
