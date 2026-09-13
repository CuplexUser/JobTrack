import { describe, expect, it } from 'vitest';
import { inflateRawSync, crc32 } from 'node:zlib';
import { buildManifest, GECKO_ID } from '../scripts/manifest.mjs';
import { createZip } from '../scripts/zip.mjs';
import { newestSignedRelease, updateManifest } from '../scripts/firefox-updates.mjs';
import { JOBTRACK_ORIGINS } from '../src/browser-api.js';

/** Read a zip back through its central directory, the way an unzipper does. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let pointer = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();

  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(pointer)).toBe(0x02014b50);
    const method = zip.readUInt16LE(pointer + 10);
    const checksum = zip.readUInt32LE(pointer + 16);
    const compressedSize = zip.readUInt32LE(pointer + 20);
    const nameLength = zip.readUInt16LE(pointer + 28);
    const localOffset = zip.readUInt32LE(pointer + 42);
    const name = zip.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8');

    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const start = localOffset + 30 + localNameLength;
    const body = zip.subarray(start, start + compressedSize);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(crc32(data)).toBe(checksum);

    files.set(name, data);
    pointer += 46 + nameLength;
  }
  return files;
}

describe('createZip', () => {
  const entries = [
    { name: 'popup.js', data: Buffer.from('console.log("hi");\n'.repeat(50)) },
    { name: 'chunks/settings.js', data: Buffer.from('export const a = 1;') },
    { name: 'icon.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    { name: 'naïve.txt', data: Buffer.from('UTF-8 names') },
  ];

  it('writes a zip that reads back byte for byte', () => {
    const files = readZip(createZip(entries));
    expect([...files.keys()]).toEqual(['chunks/settings.js', 'icon.png', 'naïve.txt', 'popup.js']);
    for (const entry of entries) expect(files.get(entry.name)).toEqual(entry.data);
  });

  it('produces the same bytes for the same files, in any order', () => {
    expect(createZip(entries).equals(createZip([...entries].reverse()))).toBe(true);
  });

  it('refuses names that could land outside the folder it is unpacked into', () => {
    expect(() => createZip([{ name: '../evil.js', data: Buffer.from('') }])).toThrow(/unsafe/);
    expect(() => createZip([{ name: '/abs.js', data: Buffer.from('') }])).toThrow(/unsafe/);
  });
});

describe('buildManifest', () => {
  it('keeps Firefox-only settings out of the Chromium manifest', () => {
    const manifest = buildManifest('chromium', '1.2.3');
    expect(manifest.version).toBe('1.2.3');
    expect(manifest).not.toHaveProperty('browser_specific_settings');
  });

  it('gives Firefox its permanent id, an update URL and a data collection declaration', () => {
    const settings = buildManifest('firefox', '1.2.3').browser_specific_settings;
    expect(settings.gecko.id).toBe(GECKO_ID);
    expect(settings.gecko.update_url).toMatch(/^https:\/\//);
    expect(settings.gecko.data_collection_permissions.required).toEqual(['none']);
  });

  // The extension checks and requests exactly this list at runtime; if the manifest grew a
  // host the code did not know about, Firefox would ask for one thing and the code check another.
  it('asks for the same hosts the extension checks for', () => {
    expect(buildManifest('firefox', '1.0.0').host_permissions).toEqual(JOBTRACK_ORIGINS);
  });
});

describe('the Firefox update manifest', () => {
  const release = (tag: string, assets: string[], extra: Record<string, unknown> = {}) => ({
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: assets.map((name) => ({ name, url: `https://api.github.com/assets/${name}` })),
    ...extra,
  });

  it('picks the newest signed add-on, comparing versions as numbers', () => {
    const newest = newestSignedRelease([
      release('clipper-v1.9.0', ['jobtrack-clipper-1.9.0.xpi']),
      release('clipper-v1.10.0', ['jobtrack-clipper-1.10.0.xpi']),
      release('v1.3.0', ['JobTrack-Setup-1.3.0.exe']),
    ]);
    expect(newest?.version).toBe('1.10.0');
  });

  it('skips drafts and releases whose signing never produced a file', () => {
    expect(
      newestSignedRelease([
        release('clipper-v2.0.0', ['jobtrack-clipper-2.0.0.xpi'], { draft: true }),
        release('clipper-v1.2.0', []),
        release('clipper-v1.1.0', ['jobtrack-clipper-1.1.0.xpi']),
      ])?.version,
    ).toBe('1.1.0');
    expect(newestSignedRelease([release('v1.2.0', ['JobTrack-Setup-1.2.0.exe'])])).toBeNull();
  });

  it('describes the update under the add-on id, with a hash Firefox checks the download against', () => {
    const manifest = updateManifest('1.1.0', 'https://example.test/jobtrack-clipper-1.1.0.xpi', 'ab12');
    expect(manifest.addons[GECKO_ID].updates).toEqual([
      expect.objectContaining({ version: '1.1.0', update_hash: 'sha256:ab12' }),
    ]);
  });
});
