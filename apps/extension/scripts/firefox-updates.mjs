/**
 * Publish the Firefox add-on's install file and update manifest to GitHub Pages.
 *
 *   node apps/extension/scripts/firefox-updates.mjs <pages output folder>
 *
 * Run by the Pages deploy (`.github/workflows/demo.yml`) with `GITHUB_TOKEN` and
 * `GITHUB_REPOSITORY` set. It finds the newest `clipper-v*` GitHub release that has a signed
 * `.xpi` attached and writes, under `<output>/clipper/`:
 *
 * - `jobtrack-clipper.xpi`: always the newest version, so the install link never changes.
 * - `jobtrack-clipper-<version>.xpi`: the same file under a name that does, which is what the
 *   update manifest points at, so a cached copy of the unversioned name can never be served
 *   as an update.
 * - `updates.json`: the manifest Firefox polls through `update_url` (`manifest.mjs`).
 *
 * Why Pages and not the release itself: Firefox wants the update manifest at a URL that stays
 * put, over HTTPS, and GitHub Pages serves both files with ordinary content types from an
 * address this repository already owns.
 *
 * With no signed release yet it writes nothing and exits cleanly, so the Pages deploy never
 * fails on the add-on's account.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FIREFOX_MIN_VERSION, FIREFOX_UPDATE_URL, GECKO_ID } from './manifest.mjs';

const TAG_PREFIX = 'clipper-v';

/** `1.10.0` is newer than `1.9.2`: compare numerically, part by part. */
export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The newest release with a signed add-on attached, from GitHub's release list.
 * @param {{ tag_name: string; draft: boolean; prerelease: boolean; assets: { name: string; url: string }[] }[]} releases
 */
export function newestSignedRelease(releases) {
  const candidates = releases
    .filter((release) => release.tag_name.startsWith(TAG_PREFIX) && !release.draft && !release.prerelease)
    .map((release) => ({
      version: release.tag_name.slice(TAG_PREFIX.length),
      asset: release.assets.find((asset) => asset.name.endsWith('.xpi')),
    }))
    .filter((candidate) => candidate.asset && /^\d+(\.\d+)*$/.test(candidate.version));
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0] ?? null;
}

/** The update manifest Firefox reads. Format: extensionworkshop.com, "Updating your extension". */
export function updateManifest(version, updateLink, sha256) {
  return {
    addons: {
      [GECKO_ID]: {
        updates: [
          {
            version,
            update_link: updateLink,
            update_hash: `sha256:${sha256}`,
            applications: { gecko: { strict_min_version: FIREFOX_MIN_VERSION } },
          },
        ],
      },
    },
  };
}

async function main() {
  const output = process.argv[2];
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository } = process.env;
  if (!output || !repository) {
    console.error('usage: GITHUB_REPOSITORY=owner/repo node firefox-updates.mjs <output folder>');
    process.exit(2);
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100`, { headers });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} listing releases`);
  const newest = newestSignedRelease(await response.json());
  if (!newest) {
    console.log('No signed Firefox add-on released yet; nothing to publish.');
    return;
  }

  // The asset API URL, asked for as a download, redirects to the file itself.
  const download = await fetch(newest.asset.url, { headers: { ...headers, Accept: 'application/octet-stream' } });
  if (!download.ok) throw new Error(`GitHub answered ${download.status} downloading ${newest.asset.name}`);
  const xpi = Buffer.from(await download.arrayBuffer());
  const sha256 = createHash('sha256').update(xpi).digest('hex');

  const folder = join(output, 'clipper');
  mkdirSync(folder, { recursive: true });
  const versionedName = `jobtrack-clipper-${newest.version}.xpi`;
  writeFileSync(join(folder, 'jobtrack-clipper.xpi'), xpi);
  writeFileSync(join(folder, versionedName), xpi);

  const base = FIREFOX_UPDATE_URL.slice(0, FIREFOX_UPDATE_URL.lastIndexOf('/') + 1);
  const manifest = updateManifest(newest.version, `${base}${versionedName}`, sha256);
  writeFileSync(join(folder, 'updates.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Published JobTrack Clipper ${newest.version} for Firefox (sha256 ${sha256}).`);
}

// Run only as a script, so the tests can import the pure parts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
