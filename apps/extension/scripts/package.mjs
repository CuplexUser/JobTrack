/**
 * Package a built extension for release.
 *
 *   npm run package --workspace=@jobtrack/extension
 *
 * Runs after `vite build` and writes, into `release/`:
 *
 * - `firefox/`: the unpacked Firefox add-on, with the Firefox manifest. This is the folder
 *   `web-ext sign` sends to Mozilla, and what `about:debugging` can load for testing.
 * - `jobtrack-clipper-<version>-firefox.zip`: the same, zipped, for uploading by hand at
 *   addons.mozilla.org if the workflow is ever not the way.
 * - `jobtrack-clipper-<version>-chromium.zip`: the Chromium manifest, for a Chromium store
 *   listing once there is one.
 *
 * Only files a browser loads go in. `dist/` also holds source maps and the type declarations
 * `tsc --build` writes there, and neither belongs in a package.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './manifest.mjs';
import { createZip } from './zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const release = join(root, 'release');

/** What a browser loads. Everything else in `dist/` is left behind. */
const PACKAGED_EXTENSIONS = new Set(['.html', '.js', '.css', '.png']);

/** @param {string} directory */
function listFiles(directory) {
  /** @type {string[]} */
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

/** @param {string} directory @returns {{ name: string; data: Buffer }[]} */
function packagedEntries(directory) {
  return listFiles(directory)
    .filter((path) => PACKAGED_EXTENSIONS.has(extname(path)) && !path.endsWith('.d.ts'))
    .map((path) => ({ name: relative(directory, path).split(sep).join('/'), data: readFileSync(path) }));
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

let built;
try {
  built = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
} catch {
  console.error('No dist/manifest.json. Run the build first: npm run build --workspace=@jobtrack/extension');
  process.exit(1);
}
if (built.version !== version) {
  console.error(`dist/ was built at ${built.version}, but package.json says ${version}. Rebuild first.`);
  process.exit(1);
}

rmSync(release, { recursive: true, force: true });
mkdirSync(release, { recursive: true });

const files = packagedEntries(dist);

for (const target of /** @type {const} */ (['firefox', 'chromium'])) {
  const manifest = { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(buildManifest(target, version), null, 2)}\n`) };
  const entries = [...files, manifest];
  const zipName = `jobtrack-clipper-${version}-${target}.zip`;
  writeFileSync(join(release, zipName), createZip(entries));

  if (target === 'firefox') {
    for (const entry of entries) {
      const path = join(release, 'firefox', ...entry.name.split('/'));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, entry.data);
    }
  }
  console.log(`${relative(root, join(release, zipName))} (${entries.length} files)`);
}
