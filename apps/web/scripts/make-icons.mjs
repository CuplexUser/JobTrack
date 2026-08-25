/**
 * Rasterise the favicon source artwork into the fallback formats.
 *
 *   npm run icons --workspace=@jobtrack/web
 *
 * Sources:
 *   public/favicon.svg       the full mark, shipped as-is for modern browsers
 *   icons/favicon-small.svg  a hand-tuned variant for 16 and 20px
 *
 * Outputs (all in public/):
 *   favicon.ico            16/20/32/48px
 *   apple-touch-icon.png   180px, full-bleed
 *
 * Regenerate whenever either source SVG changes. sharp is already present as a transitive
 * dependency, so this needs no extra install.
 */

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(webRoot, 'public');

const full = await readFile(join(PUBLIC, 'favicon.svg'));
const small = await readFile(join(webRoot, 'icons', 'favicon-small.svg'));

/** Render at high density then downsample, so small sizes stay crisp. */
async function png(source, size) {
  return sharp(source, { density: 512 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Build an .ico containing PNG payloads.
 *
 * 6-byte header, then one 16-byte directory entry per image, then the PNG blobs.
 * PNG-in-ICO is understood by every browser that still asks for an .ico at all.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach(({ size, data }, index) => {
    const at = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at + 0); // width (0 means 256)
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1); // height
    directory.writeUInt8(0, at + 2); // palette size
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.data)]);
}

// Small sizes come from the simplified artwork; 32 and 48 have room for the full mark.
const entries = [
  { size: 16, source: small },
  { size: 20, source: small },
  { size: 32, source: full },
  { size: 48, source: full },
];

const images = [];
for (const { size, source } of entries) {
  images.push({ size, data: await png(source, size) });
}
await writeFile(join(PUBLIC, 'favicon.ico'), buildIco(images));

// iOS applies its own rounded mask and renders transparency as black, so the touch icon
// is the same mark full-bleed: square corners, no transparent margin.
const fullBleed = Buffer.from(full.toString('utf8').replace('rx="7.5"', 'rx="0"'));
await writeFile(join(PUBLIC, 'apple-touch-icon.png'), await png(fullBleed, 180));

console.log(`favicon.ico          ${entries.map((e) => e.size).join('/')}px`);
console.log('apple-touch-icon.png 180px');
