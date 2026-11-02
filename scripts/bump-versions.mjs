/**
 * Bumps the version of every publishable package that needs one, so the next push to main
 * releases it (see docs/publishing.md: a version bump on main *is* the release).
 *
 * "Needs one" is decided by the same check CI's publish gate runs (`check-publishable.mjs`),
 * so this bumps exactly what that gate would otherwise refuse:
 *
 *   - a package whose published tarball differs from what this checkout would pack, or
 *   - the tray, when sources it bundles (the web UI, `.env.example`) changed since its
 *     version was set, committed or not. The gate only sees committed changes; a bump is
 *     usually made before committing, so uncommitted ones count here too.
 *
 * A package whose current version is not on the registry yet is already bumped and waiting
 * to be published, so it is left alone.
 *
 * Bumps cascade in dependency order, the way the hand-made release commits always did: when
 * `@jobtrack/shared` moves, `@jobtrack/api`, `@jobtrack/mcp` and the tray get their `^` range
 * moved to match, and that changed package.json is itself a change that needs a new version.
 * `package-lock.json` is updated to match.
 *
 * Usage (from the repo root):
 *
 *   npm run bump minor              # or major / patch
 *   npm run bump minor -- --dry-run # show what would change, write nothing
 *   node scripts/bump-versions.mjs --patch
 *   node scripts/bump-versions.mjs --check   # the pre-push hook: exit 1 if a bump is missing
 *
 * `--check` writes nothing and judges only what is committed (uncommitted changes are not
 * part of a push). The package tarballs are still packed from the working tree, so an
 * uncommitted edit to a package's own files can make it fail; commit or stash it.
 *
 * It reads the npm registry and packs each package locally (the tray's pack rebuilds the web
 * UI), so it takes a minute. Nothing is committed or pushed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGES, inspect } from './check-publishable.mjs';

const LEVELS = ['major', 'minor', 'patch'];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: npm run bump <major|minor|patch> [-- --dry-run]
       node scripts/bump-versions.mjs --major|--minor|--patch [--dry-run]
       node scripts/bump-versions.mjs --check   (exit 1 if a committed change needs a bump)`;

function parseArgs(argv) {
  const words = argv.map((arg) => arg.replace(/^--/, ''));
  if (words.includes('help') || words.includes('h')) {
    console.log(USAGE);
    process.exit(0);
  }
  const levels = words.filter((word) => LEVELS.includes(word));
  const unknown = words.filter((word) => !LEVELS.includes(word) && word !== 'dry-run' && word !== 'check');
  if (words.includes('check')) {
    if (levels.length > 0 || unknown.length > 0 || words.includes('dry-run')) {
      console.error('--check takes no other arguments.');
      console.error(USAGE);
      process.exit(2);
    }
    // The level only shapes the suggested version numbers; nothing is written.
    return { level: 'patch', dryRun: true, check: true };
  }
  if (levels.length !== 1 || unknown.length > 0) {
    if (unknown.length > 0) console.error(`Unknown argument: ${unknown.join(', ')}`);
    else console.error(levels.length === 0 ? 'Choose major, minor or patch.' : 'Choose only one of major, minor or patch.');
    console.error(USAGE);
    process.exit(2);
  }
  return { level: levels[0], dryRun: words.includes('dry-run'), check: false };
}

function increment(version, level) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Cannot bump "${version}": only plain major.minor.patch versions are supported.`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** A JSON file read so it can be written back with the same indentation and line endings. */
function readJson(path) {
  const text = readFileSync(path, 'utf8');
  return {
    path,
    data: JSON.parse(text),
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    indent: /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  ',
  };
}

function writeJson({ path, data, eol, indent }) {
  writeFileSync(path, `${JSON.stringify(data, null, indent).replaceAll('\n', eol)}${eol}`);
}

/** Changed or untracked files under `paths` that are not committed yet. */
function uncommittedChanges(paths) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...paths], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`git status failed: ${result.stderr.trim()}`);
  return result.stdout.split('\n').filter(Boolean);
}

function buildShared() {
  // check-publishable packs @jobtrack/shared, which ships dist/; `npm pack` won't build it.
  // Through a shell as one string, since Node will not spawn npm.cmd directly on Windows.
  const result = spawnSync('npm run build --workspace=@jobtrack/shared', { cwd: repoRoot, shell: true, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Building @jobtrack/shared failed.');
}

const { level, dryRun, check } = parseArgs(process.argv.slice(2));

console.log('Building @jobtrack/shared and comparing every package with the registry...\n');
buildShared();

/** name -> the version it will have after this run, for the dependents that follow it. */
const versions = new Map();
const changes = [];
const unchanged = [];

for (const entry of PACKAGES) {
  const manifest = readJson(join(repoRoot, entry.dir, 'package.json'));
  const { name, version } = manifest.data;
  const result = await inspect(entry);
  const reasons = [];

  if (result.status === 'fail') reasons.push(result.reason);
  // --check asks about what is being pushed, which uncommitted changes are not part of.
  if (!check && result.status === 'skip' && entry.bundles) {
    const pending = uncommittedChanges(entry.bundles);
    if (pending.length > 0) reasons.push(`${entry.bundles.join(' / ')} has ${pending.length} uncommitted change(s)`);
  }

  const ranges = [];
  for (const field of DEPENDENCY_FIELDS) {
    for (const [dependency, range] of Object.entries(manifest.data[field] ?? {})) {
      const target = versions.get(dependency);
      const prefix = /^([\^~]?)\d/.exec(range)?.[1];
      if (!target || prefix === undefined || range === `${prefix}${target}`) continue;
      ranges.push({ field, dependency, from: range, to: `${prefix}${target}` });
    }
  }
  if (ranges.length > 0) reasons.push(`depends on ${ranges.map((range) => `${range.dependency} ${range.to}`).join(', ')}`);

  // Not on the registry yet: already bumped, waiting for the next push. Only ranges move.
  const next = reasons.length > 0 && result.status !== 'publish' ? increment(version, level) : version;
  versions.set(name, next);
  if (next !== version || ranges.length > 0) {
    changes.push({ dir: entry.dir, manifest, name, from: version, to: next, ranges, reasons });
  } else {
    unchanged.push({ name, version });
  }
}

console.log('');
if (changes.length === 0) {
  console.log('Nothing to bump: every package is either unchanged since its published version or already bumped.');
  process.exit(0);
}

for (const change of changes) {
  console.log(
    change.from === change.to
      ? `${change.name} ${change.from} (already bumped, not published yet; ranges only)`
      : `${change.name} ${change.from} -> ${change.to}`,
  );
  for (const reason of change.reasons) console.log(`    ${reason}`);
}
for (const { name, version } of unchanged) console.log(`${name} ${version} (no bump needed)`);
console.log('');

if (check) {
  console.error(
    'The Publish to npm workflow would refuse this push: the packages above changed without a new version.\n' +
      'Run `npm run bump patch` (or minor / major), commit the result, and push again.\n' +
      'To push anyway: git push --no-verify',
  );
  process.exit(1);
}

if (dryRun) {
  console.log('Dry run: nothing was written.');
  process.exit(0);
}

const lockfile = readJson(join(repoRoot, 'package-lock.json'));
for (const change of changes) {
  change.manifest.data.version = change.to;
  const locked = lockfile.data.packages?.[change.dir];
  if (locked) locked.version = change.to;
  for (const range of change.ranges) {
    change.manifest.data[range.field][range.dependency] = range.to;
    if (locked?.[range.field]) locked[range.field][range.dependency] = range.to;
  }
  writeJson(change.manifest);
}
writeJson(lockfile);

console.log(`Updated ${changes.map((change) => `${change.dir}/package.json`).join(', ')} and package-lock.json.`);
console.log('Review the diff, commit, and push to main to publish.');
