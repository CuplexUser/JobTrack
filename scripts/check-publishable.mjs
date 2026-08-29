/**
 * Decides, for each publishable package, what this commit should do with it: publish it,
 * skip it, or fail the build.
 *
 * `publish-all.ps1` answers only the first question — "is this version already on the
 * registry?" — and skips when it is. That silently allows the defect this exists to catch:
 * changing a package's sources without bumping its version, so the registry keeps serving
 * the old tarball while the repo has moved on (see ROADMAP.md item 7). So this compares
 * *content*, not just version numbers:
 *
 *   publish  version isn't on the registry yet
 *   skip     version is on the registry and its tarball matches this checkout — an
 *            unchanged package legitimately keeps its version while siblings move ahead
 *   fail     version is on the registry but its tarball does NOT match this checkout —
 *            the sources changed and nobody bumped the version
 *
 * Any `fail` exits non-zero, which is the point: a red build instead of a skipped step.
 *
 * Comparison is between the published tarball and a locally packed one, so it sees exactly
 * what npm would ship — `files` lists, `prepack` output and package.json included, rather
 * than guessing which paths matter. Two deliberate exclusions:
 *
 *   - `vendor/` (the tray's staged web UI) is a build artifact rebuilt from source on every
 *     pack. Comparing it would test the build's byte-reproducibility across machines, not
 *     whether anyone edited the sources. Instead, a package that bundles sources it doesn't
 *     own declares them in `bundles`, and git answers the question the tarball can't: did
 *     any of them change after the commit that set this version? `jobtrack@1.0.6` shipped a
 *     web UI two commits stale precisely because nothing asked that. Differences under
 *     `vendor/` are still printed, just as a note rather than a failure.
 *   - Line endings are normalized before hashing. The repo is developed on Windows with
 *     core.autocrlf=true, so tarballs packed there carry CRLF while a Linux CI checkout has
 *     LF. Without this every text file in every package would read as changed.
 *
 * Usage:
 *   node scripts/check-publishable.mjs [--plan <path>]
 *
 * Build `@jobtrack/shared` first (`npm run build --workspace=@jobtrack/shared`) — it ships
 * `dist/`, which `npm pack` does not build on its own (that's `prepublishOnly`'s job, and
 * that only runs for a real publish).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

// Dependency order, same as publish-all.ps1: @jobtrack/shared first (apps/api depends on
// it), then @jobtrack/api (apps/mcp and apps/tray both depend on it), then the two leaves.
//
// `bundles` lists sources a package ships but doesn't own, which therefore can't be caught by
// comparing tarballs (see BUNDLED_PREFIXES). apps/tray stages a built copy of the web UI and
// the root .env.example into vendor/ at prepack time.
const PACKAGES = [
  { dir: 'packages/shared' },
  { dir: 'apps/api' },
  { dir: 'apps/mcp' },
  { dir: 'apps/tray', bundles: ['apps/web', '.env.example'] },
];

// Build artifacts, not sources: rebuilt from scratch on every pack, so comparing them across
// machines tests whether the build is byte-reproducible rather than whether anyone edited
// anything. Differences here are reported as a note; the `bundles` git check above is what
// actually gates them.
const BUNDLED_PREFIXES = ['vendor/'];

// Everything else is hashed byte-for-byte. Only these get CRLF normalized.
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt',
  '.html', '.css', '.svg', '.yml', '.yaml', '.example',
]);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org';

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

/** The `version` a package.json held at a given commit, or null if it wasn't there. */
function versionAt(commit, manifestPath) {
  const result = spawnSync('git', ['show', `${commit}:${manifestPath}`], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout).version;
  } catch {
    return null;
  }
}

/**
 * The commit that last set a package to its current version.
 *
 * Not the same as the last commit touching its package.json — dependency ranges and scripts
 * change without a release. Walks that file's history newest-first and keeps going while the
 * version still reads as it does now; the oldest such commit is the bump.
 */
function versionBumpCommit(dir, version) {
  const manifestPath = `${dir}/package.json`;
  let bump = null;
  for (const commit of git(['log', '--format=%H', '--', manifestPath]).split('\n').filter(Boolean)) {
    if (versionAt(commit, manifestPath) !== version) break;
    bump = commit;
  }
  return bump;
}

/** Commits touching any of `paths` after `since` — i.e. bundled sources that moved on. */
function commitsSince(since, paths) {
  return git(['log', '--format=%h %s', `${since}..HEAD`, '--', ...paths]).split('\n').filter(Boolean);
}

/**
 * The tarball URL for an exact name@version, or null when that version isn't published.
 *
 * Asking the registry over HTTP rather than shelling out to `npm view`: it's one request
 * with an unambiguous 404 for "no such version", where `npm view`'s non-zero exit could
 * equally mean the network died or the CLI failed to launch — and a misread there would
 * wave an already-published version through as new.
 */
async function publishedTarballUrl(name, version) {
  const response = await fetch(`${REGISTRY}/${name.replace('/', '%2F')}/${version}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Registry lookup for ${name}@${version} failed: ${response.status}`);
  return (await response.json()).dist.tarball;
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

function packLocally(packageDir) {
  // A dedicated directory, so the tarball this produces is the only .tgz in it.
  const destination = mkdtempSync(join(tmpdir(), 'jobtrack-pack-'));
  // Through a shell, as one string: Node refuses to spawn npm.cmd directly on Windows, and
  // passing an args array alongside `shell` is deprecated for concatenating them unescaped.
  const result = spawnSync(`npm pack --pack-destination "${destination}"`, {
    cwd: packageDir,
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'inherit'], // prepack logs go straight to the build output
  });
  if (result.status !== 0) throw new Error(`npm pack failed in ${packageDir}`);

  const tarball = readdirSync(destination).find((entry) => entry.endsWith('.tgz'));
  if (!tarball) throw new Error(`npm pack produced no tarball in ${destination}`);
  try {
    return readFileSync(join(destination, tarball));
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
}

function readTarString(buffer, start, length) {
  const field = buffer.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
}

/** The `path=` record of a pax extended header, which npm uses for long filenames. */
function paxPath(body) {
  for (const record of body.toString('utf8').split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match) return match[1];
  }
  return null;
}

/**
 * Reads a .tgz into a path -> contents map. Node has no built-in tar, but the format is a
 * sequence of 512-byte headers each followed by its file's bytes padded to 512 — far less
 * trouble than shelling out to a `tar` binary that differs across the platforms this runs
 * on (Git Bash's GNU tar reads a `C:\...` argument as a remote host).
 */
function readTarball(gzipped) {
  const buffer = gunzipSync(gzipped);
  const entries = new Map();
  let offset = 0;
  let longName = null;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break; // two zero blocks mark the end

    const size = Number.parseInt(readTarString(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    const body = buffer.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === 'L') {
      longName = readTarString(body, 0, body.length); // GNU long name
      continue;
    }
    if (type === 'x') {
      longName = paxPath(body) ?? longName; // pax extended header
      continue;
    }

    const prefix = readTarString(header, 345, 155);
    const name = longName ?? (prefix ? `${prefix}/${readTarString(header, 0, 100)}` : readTarString(header, 0, 100));
    longName = null;

    if (type === '0' || type === '\0') entries.set(name, body);
  }
  return entries;
}

/** Hashes a tarball's files by their path inside the package. */
function hashTarball(gzipped) {
  const hashes = new Map();

  for (const [name, contents] of readTarball(gzipped)) {
    // npm tarballs wrap everything in a `package/` directory.
    const path = name.startsWith('package/') ? name.slice('package/'.length) : name;

    const extension = path.slice(path.lastIndexOf('.'));
    const normalized = TEXT_EXTENSIONS.has(extension)
      ? Buffer.from(contents.toString('utf8').replaceAll('\r\n', '\n'))
      : contents;
    hashes.set(path, createHash('sha256').update(normalized).digest('hex'));
  }
  return hashes;
}

const isBundled = (path) => BUNDLED_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix));

function diffTarballs(published, local, include) {
  const differences = [];
  for (const [path, hash] of local) {
    if (!include(path)) continue;
    if (!published.has(path)) differences.push(`added:   ${path}`);
    else if (published.get(path) !== hash) differences.push(`changed: ${path}`);
  }
  for (const path of published.keys()) {
    if (include(path) && !local.has(path)) differences.push(`removed: ${path}`);
  }
  return differences.sort();
}

async function inspect({ dir, bundles }) {
  const packageDir = resolve(repoRoot, dir);
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const { name, version } = manifest;

  const tarballUrl = await publishedTarballUrl(name, version);
  if (!tarballUrl) {
    return { dir, name, version, status: 'publish', reason: 'not on the registry yet' };
  }

  const published = hashTarball(await download(tarballUrl));
  const local = hashTarball(packLocally(packageDir));

  const differences = diffTarballs(published, local, (path) => !isBundled(path));
  if (differences.length > 0) {
    return { dir, name, version, status: 'fail', reason: 'already published, but the contents differ', differences };
  }

  // The package's own files match. Its bundled sources are a separate question: they reach
  // the tarball only as build output, which is excluded above, so ask git instead — did
  // anything they're built from land after the commit that set this version?
  if (bundles) {
    const bump = versionBumpCommit(dir, version);
    const commits = bump ? commitsSince(bump, bundles) : [];
    if (commits.length > 0) {
      return {
        dir,
        name,
        version,
        status: 'fail',
        reason: `already published, but ${bundles.join(' / ')} changed since this version was set`,
        differences: commits.map((commit) => `commit:  ${commit}`),
      };
    }
  }

  return {
    dir,
    name,
    version,
    status: 'skip',
    reason: 'already published, unchanged',
    // Not a failure on its own: a difference here can just as easily be the build behaving
    // differently on another machine. Worth printing when it shows up, though.
    notes: diffTarballs(published, local, isBundled),
  };
}

const planPath = process.argv.includes('--plan')
  ? process.argv[process.argv.indexOf('--plan') + 1]
  : null;

// The version-bump check reads history, which a depth-1 clone doesn't have: it would find
// no bump commit and wave every stale bundle through. Fail loudly instead of silently.
if (PACKAGES.some((entry) => entry.bundles) && git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
  console.error('This is a shallow clone; the version-bump check needs full history (actions/checkout: fetch-depth: 0).');
  process.exit(1);
}

const plan = [];
for (const entry of PACKAGES) {
  plan.push(await inspect(entry));
}

const icons = { publish: '+', skip: '=', fail: 'x' };
console.log('');
for (const entry of plan) {
  console.log(`${icons[entry.status]} ${entry.name}@${entry.version} — ${entry.status}: ${entry.reason}`);
  for (const difference of entry.differences ?? []) console.log(`      ${difference}`);
  for (const note of entry.notes ?? []) console.log(`      note: bundled ${note}`);
}
console.log('');

if (planPath) writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

const failures = plan.filter((entry) => entry.status === 'fail');
if (failures.length > 0) {
  const names = failures.map((entry) => `${entry.name}@${entry.version}`).join(', ');
  console.error(
    `Refusing to publish: ${names} ${failures.length === 1 ? 'is' : 'are'} already on the ` +
      'registry with different contents. Bump the version in package.json.',
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = failures.map(
      (entry) => `- \`${entry.name}@${entry.version}\` is published with different contents — bump its version.`,
    );
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Publish blocked\n\n${lines.join('\n')}\n`);
  }
  process.exit(1);
}

if (plan.every((entry) => entry.status === 'skip')) {
  console.log('Nothing to publish — every package is already on the registry, unchanged.');
}
