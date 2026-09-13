/**
 * Rasterize the app's mark into the sizes an extension manifest asks for.
 *
 *   npm run icons --workspace=@jobtrack/extension
 *
 * Same source and same approach as `apps/web/scripts/make-icons.mjs` — the extension is the
 * same app, so it should not have a second identity. Run this only when the artwork
 * changes; the PNGs are committed.
 */

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(join(root, '..', 'web', 'public', 'favicon.svg'));

for (const size of [16, 48, 128]) {
  const png = await sharp(source, { density: 512 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(root, 'public', `icon-${size}.png`), png);
  console.log(`icon-${size}.png`);
}

// The store listing logo: Microsoft asks for a 300 x 300 image. Not part of the package, so it
// lives in store/ rather than public/.
const logo = await sharp(source, { density: 1024 })
  .resize(300, 300, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(join(root, 'store', 'logo-300.png'), logo);
console.log('store/logo-300.png');
