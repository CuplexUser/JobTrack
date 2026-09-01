#!/usr/bin/env node
/**
 * Builds the tree the Windows installer ships: a private Node runtime plus a pre-installed,
 * Windows-pruned `node_modules` holding the *published* `jobtrack` release.
 *
 * Installing from the registry rather than from this checkout is the point, not a shortcut: it
 * keeps the installer a repackaging of the npm release instead of a second, subtly different
 * build of it. Whatever `npm install -g jobtrack` would have given a user is what goes in the box.
 *
 *   node windows/scripts/build-payload.mjs --version 1.0.11 [--with-mcp] [--keep-dml]
 *
 * Options that only make sense for a local dry run, never in CI:
 *   --local             package this checkout via `npm pack` instead of the registry, so a build
 *                       can be tested before it is published -- the same verification
 *                       docs/publishing.md describes, carried through to the installer
 *   --node-exe <path>   reuse an existing node.exe instead of downloading the pinned runtime
 *   --skip-smoke        skip the launch test (its first run downloads an embedding model)
 *
 * Output layout, all paths inside --out:
 *   node/node.exe       the pinned runtime, and nothing else out of the zip
 *   app/node_modules/   jobtrack + deps, pruned to win32-x64
 *   app/launch.json     exactly how to start the server (the C# host's LaunchManifest reads it)
 *   app/tsconfig.json   pins tsx's upward tsconfig search
 *   app/npm-tree.json   what actually went in, for the release notes
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const windowsDir = resolve(scriptDir, '..');
const repoRoot = resolve(windowsDir, '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const version = option('--version') ?? JSON.parse(readFileSync(join(repoRoot, 'apps/tray/package.json'), 'utf8')).version;
const outDir = resolve(option('--out', join(windowsDir, 'installer/payload')));
const withMcp = flag('--with-mcp');
const keepDml = flag('--keep-dml');
const reuseNodeExe = option('--node-exe');
const skipSmoke = flag('--skip-smoke');
const local = flag('--local');

const appDir = join(outDir, 'app');
const nodeDir = join(outDir, 'node');
const nodeExe = join(nodeDir, 'node.exe');
/**
 * npm, invoked as JavaScript rather than through its shim.
 *
 * Node refuses to `spawn` a `.cmd` file without a shell since the CVE-2024-27980 fix, and going
 * through a shell would then need hand-quoting for the install prefix (which can contain spaces).
 * npm ships its own CLI entry point beside the running node, so drive that directly and neither
 * problem exists. The shim is kept as a fallback for a layout that doesn't have it.
 */
const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const runNpm = (npmArgs, options = {}) => (existsSync(npmCli)
  ? execFileSync(process.execPath, [npmCli, ...npmArgs], { stdio: 'inherit', ...options })
  : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, { stdio: 'inherit', shell: true, ...options }));

const REGISTRY = 'https://registry.npmjs.org';
const summary = [];

const step = (message) => console.log(`\n=== ${message}`);

function fail(message) {
  console.error(`\nBUILD FAILED: ${message}`);
  process.exit(1);
}

/** Recursive size in bytes, tolerant of a path that isn't there. */
function sizeOf(path) {
  if (!existsSync(path)) return 0;
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.size;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) total += sizeOf(join(path, entry.name));
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ---------------------------------------------------------------------------------------------
// 1. Refuse to package a version that isn't on the registry.
//
// This is what lets the release workflow fire after every publish run: a push that bumped nothing
// leaves this version either already released (the workflow's own idempotence check catches that)
// or never published, and we stop here rather than building an installer around a tarball that
// does not exist.
// ---------------------------------------------------------------------------------------------
if (local) {
  console.log(`
=== Packaging jobtrack@${version} from this checkout (--local)`);
} else {
  step(`Checking jobtrack@${version} is published`);
  const manifestResponse = await fetch(`${REGISTRY}/jobtrack/${version}`);
  if (manifestResponse.status === 404) {
    fail(
      `jobtrack@${version} is not on the registry. Publish it first -- a push to main does that. `
      + 'To package this checkout as it stands instead, pass --local.',
    );
  }
  if (!manifestResponse.ok) fail(`registry returned ${manifestResponse.status} for jobtrack@${version}`);
  const published = await manifestResponse.json();
  console.log(`  ${published.name}@${published.version}  ${published.dist.integrity}`);
}

// ---------------------------------------------------------------------------------------------
// 2. The Node runtime. Only node.exe — no npm, no corepack, no bundled node_modules.
// ---------------------------------------------------------------------------------------------
rmSync(outDir, { recursive: true, force: true });
mkdirSync(nodeDir, { recursive: true });

const nodeVersion = readFileSync(join(windowsDir, 'node-version.txt'), 'utf8').trim();
if (reuseNodeExe) {
  step(`Reusing ${reuseNodeExe} — local dry run only; CI always downloads the pinned runtime`);
  cpSync(reuseNodeExe, nodeExe);
} else {
  step(`Fetching Node ${nodeVersion} (win-x64)`);
  const zipName = `node-v${nodeVersion}-win-x64.zip`;
  const base = `https://nodejs.org/dist/v${nodeVersion}`;

  const zipResponse = await fetch(`${base}/${zipName}`);
  if (!zipResponse.ok) fail(`could not download ${base}/${zipName} (${zipResponse.status})`);
  const zipBytes = Buffer.from(await zipResponse.arrayBuffer());

  // Verify before extracting, not after: pinning a version buys nothing if a corrupted or
  // substituted archive gets unpacked first.
  const shasums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const expected = shasums.split('\n').find((line) => line.trim().endsWith(zipName))?.trim().split(/\s+/)[0];
  if (!expected) fail(`${zipName} is not listed in SHASUMS256.txt`);
  const actual = createHash('sha256').update(zipBytes).digest('hex');
  if (actual !== expected) fail(`SHA-256 mismatch for ${zipName}\n  expected ${expected}\n  actual   ${actual}`);
  console.log(`  sha256 ok: ${actual}`);

  const scratch = join(outDir, '.node-zip');
  mkdirSync(scratch, { recursive: true });
  writeFileSync(join(scratch, zipName), zipBytes);
  // bsdtar has shipped with Windows since 1803 and reads zip; it beats Expand-Archive by a wide
  // margin on a 30 MB archive.
  execFileSync('tar', ['-xf', zipName], { cwd: scratch, stdio: 'inherit' });
  const extracted = join(scratch, `node-v${nodeVersion}-win-x64`);
  cpSync(join(extracted, 'node.exe'), nodeExe);
  cpSync(join(extracted, 'LICENSE'), join(nodeDir, 'LICENSE'));
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`  node.exe: ${mb(sizeOf(nodeExe))}`);

// ---------------------------------------------------------------------------------------------
// 3. Install from the registry into a real prefix.
//
// The prefix needs its own package.json, or npm walks up, finds the monorepo's, and installs into
// the repo's own node_modules. Install scripts are left ON deliberately: onnxruntime-node's
// postinstall is a no-op for win32/x64, and leaving them on is what keeps this tree identical to
// what a user's own `npm i -g jobtrack` produces.
// ---------------------------------------------------------------------------------------------
step(`Installing jobtrack@${version}${withMcp ? ' + @jobtrack/mcp@latest' : ''}`);
mkdirSync(appDir, { recursive: true });
writeFileSync(
  join(appDir, 'package.json'),
  `${JSON.stringify({ name: 'jobtrack-payload', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`,
);

const specs = local ? packLocalTarballs() : [`jobtrack@${version}`, ...(withMcp ? ['@jobtrack/mcp@latest'] : [])];
runNpm(['install', '--prefix', appDir, '--omit=dev', '--no-audit', '--no-fund', ...specs]);

/**
 * `npm pack` every workspace package, in dependency order, and return the tarball paths.
 *
 * Installing all of them in one command is what makes this work without a registry: npm places
 * each tarball at the root of the prefix, and `jobtrack`'s own `@jobtrack/api@^1.0.6` requirement
 * is then satisfied by the 1.0.7 sitting there rather than being fetched. Same trick
 * docs/publishing.md recommends for checking a release by hand, one step further along.
 */
function packLocalTarballs() {
  const packDir = join(outDir, '.tarballs');
  mkdirSync(packDir, { recursive: true });

  // @jobtrack/shared ships dist/, which only its prepublishOnly builds -- and that does not run
  // for `npm pack`. Build it up front or the tarball is missing its entire contents.
  runNpm(['run', 'build', '--workspace=@jobtrack/shared'], { cwd: repoRoot });

  const packages = ['packages/shared', 'apps/api', ...(withMcp ? ['apps/mcp'] : []), 'apps/tray'];
  return packages.map((dir) => {
    // apps/tray's prepack (stage-assets.mjs) rebuilds the web UI into vendor/ here, exactly as it
    // would for a real publish.
    const before = new Set(readdirSync(packDir));
    runNpm(['pack', '--pack-destination', packDir], { cwd: join(repoRoot, dir), stdio: 'inherit' });
    // Whatever appeared is the tarball -- steadier than parsing npm's stdout, which carries
    // notices and progress alongside the file name.
    const tarball = readdirSync(packDir).find((name) => !before.has(name));
    if (!tarball) fail(`npm pack produced no tarball for ${dir}`);
    console.log(`  packed ${dir} -> ${tarball}`);
    return join(packDir, tarball);
  });
}

const rawSize = sizeOf(appDir);
console.log(`  installed tree: ${mb(rawSize)}`);

const installedVersion = (path) => {
  const manifest = join(appDir, 'node_modules', path, 'package.json');
  return existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).version : null;
};
const versions = {
  jobtrack: installedVersion('jobtrack'),
  api: installedVersion('@jobtrack/api'),
  shared: installedVersion('@jobtrack/shared'),
  mcp: installedVersion('@jobtrack/mcp'),
};
if (versions.jobtrack !== version) fail(`installed jobtrack@${versions.jobtrack}, expected ${version}`);
console.log(`  ${JSON.stringify(versions)}`);

try {
  writeFileSync(
    join(appDir, 'npm-tree.json'),
    runNpm(['ls', '--all', '--json'], { cwd: appDir, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }),
  );
} catch (error) {
  // `npm ls` exits non-zero over peer-dependency quibbles that say nothing about the tree we just
  // installed, and it still prints the tree on stdout.
  writeFileSync(join(appDir, 'npm-tree.json'), error.stdout ?? '{}');
}

// ---------------------------------------------------------------------------------------------
// 4. Prune to win32-x64, per scripts/prune.json.
// ---------------------------------------------------------------------------------------------
step('Pruning to win32-x64');
rmSync(join(outDir, '.tarballs'), { recursive: true, force: true });
const prune = JSON.parse(readFileSync(join(scriptDir, 'prune.json'), 'utf8'));
let reclaimed = 0;

function drop(relPath, label) {
  const target = join(appDir, relPath);
  if (!existsSync(target)) return;
  const freed = sizeOf(target);
  rmSync(target, { recursive: true, force: true });
  reclaimed += freed;
  if (freed > 512 * 1024) console.log(`  - ${label ?? relPath}  ${mb(freed)}`);
}

for (const path of prune.delete) drop(path);
if (keepDml) {
  console.log('  --keep-dml: leaving the DirectML execution provider in place');
} else {
  for (const path of prune.deleteUnlessKeepDml) drop(path);
}
for (const { dir, keep } of prune.keepOnly) {
  const target = join(appDir, dir);
  if (!existsSync(target)) continue;
  for (const entry of readdirSync(target)) {
    if (!keep.includes(entry)) drop(`${dir}/${entry}`);
  }
}

// The by-name sweep. Nothing under node_modules is loaded by name out of a `test/` directory, so
// scoping this per-package would be over-thinking it.
const dropNames = new Set(prune.deleteDirNames);
function sweep(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dropNames.has(entry.name)) {
        reclaimed += sizeOf(full);
        rmSync(full, { recursive: true, force: true });
      } else {
        sweep(full);
      }
    } else if (prune.deleteExtensions.some((extension) => entry.name.endsWith(extension))) {
      reclaimed += statSync(full).size;
      rmSync(full, { force: true });
    }
  }
}
sweep(join(appDir, 'node_modules'));

const prunedSize = sizeOf(appDir);
console.log(`  ${mb(rawSize)} -> ${mb(prunedSize)}  (reclaimed ${mb(reclaimed)})`);

// ---------------------------------------------------------------------------------------------
// 5. Assert the prune took nothing load-bearing.
//
// Without this the list rots silently the first time a dependency reorganizes its files, and the
// failure surfaces on a user's machine as a blank page, or as a search that quietly stopped being
// semantic.
// ---------------------------------------------------------------------------------------------
step('Verifying the pruned tree');
const missing = prune.require.filter((path) => !existsSync(join(appDir, path)));
if (missing.length) fail(`pruning removed files the app needs:\n  ${missing.join('\n  ')}`);

const strays = prune.forbidPrefixes.filter((prefix) => {
  const parent = join(appDir, dirname(prefix));
  if (!existsSync(parent)) return false;
  const base = prefix.split('/').pop();
  return readdirSync(parent).some((entry) => entry.startsWith(base));
});
if (strays.length) {
  fail(`non-Windows platform packages are present, so npm's platform resolution changed:\n  ${strays.join('\n  ')}`);
}
console.log(`  all ${prune.require.length} required paths present, no foreign platform packages`);

// ---------------------------------------------------------------------------------------------
// 6. Pin tsx's tsconfig search, then resolve the launch command.
// ---------------------------------------------------------------------------------------------
step('Generating launch.json');
// tsx walks *up* from the entry looking for a tsconfig.json. Left alone, an unrelated one sitting
// above the install directory silently changes how the app's TypeScript is transpiled.
writeFileSync(
  join(appDir, 'tsconfig.json'),
  `${JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext' } }, null, 2)}\n`,
);

// Resolved by the payload's own node, inside the payload's own tree, through tsx's *documented*
// export names — the neighboring files in tsx/dist are hash-named and must never be referenced.
// Doing it here rather than in the C# host means a tsx upgrade that moved them fails this build
// rather than a user's install.
const resolver = [
  "const { createRequire } = require('node:module');",
  'const req = createRequire(process.argv[1]);',
  'console.log(JSON.stringify({',
  "  preflight: req.resolve('tsx/preflight'),",
  "  loader: req.resolve('tsx'),",
  "  entry: req.resolve('jobtrack/src/cli.ts'),",
  `  mcp: ${withMcp ? "req.resolve('@jobtrack/mcp/src/index.ts')" : 'null'},`,
  '}));',
].join('\n');
const resolved = JSON.parse(execFileSync(nodeExe, ['-e', resolver, join(appDir, 'package.json')], { encoding: 'utf8' }));

/** Install-root-relative, backslash-separated — the install directory is unknown at build time. */
const rel = (absolute) => (absolute ? relative(outDir, absolute).split(sep).join('\\') : null);

const launch = {
  schema: 1,
  jobtrackVersion: versions.jobtrack,
  apiVersion: versions.api,
  sharedVersion: versions.shared,
  mcpVersion: versions.mcp,
  nodeVersion,
  node: rel(nodeExe),
  cwd: 'app',
  // `--require` takes a path, but `--import` must become a file:// URL at launch time or Node
  // reads the "C:" in a Windows path as a protocol. The host does that conversion.
  require: rel(resolved.preflight),
  import: rel(resolved.loader),
  entry: rel(resolved.entry),
  args: ['--no-tray'],
  tsconfig: 'app\\tsconfig.json',
  envExample: rel(join(appDir, 'node_modules/jobtrack/vendor/.env.example')),
  webDist: rel(join(appDir, 'node_modules/jobtrack/vendor/web-dist')),
  mcpEntry: rel(resolved.mcp),
};
writeFileSync(join(appDir, 'launch.json'), `${JSON.stringify(launch, null, 2)}\n`);
console.log(`  ${launch.node} --require ${launch.require} --import ${launch.import}`);
console.log(`  entry: ${launch.entry}`);

// MSBuild imports this, so the host assembly, the installer and the npm release carry one number.
writeFileSync(
  join(windowsDir, 'version.props'),
  `<Project>\n  <PropertyGroup>\n    <Version>${version}</Version>\n` +
    `    <InformationalVersion>${version}+node${nodeVersion}</InformationalVersion>\n  </PropertyGroup>\n</Project>\n`,
);

// ---------------------------------------------------------------------------------------------
// 7. Smoke test: start the payload exactly the way the host will.
// ---------------------------------------------------------------------------------------------
if (skipSmoke) {
  console.log('\n--skip-smoke: not launching the payload');
} else {
  step('Smoke test');
  const { smokeTest } = await import('./smoke-test.mjs');
  const result = await smokeTest({ outDir, launch, expectVersion: version });
  console.log(`  ready in ${result.coldMs} ms cold, ${result.warmMs} ms warm`);
  console.log(`  /api/meta ok, web UI served, semantic search ${result.semantic ? 'loaded' : 'FAILED'}`);
  summary.push(`Cold start ${result.coldMs} ms, warm start ${result.warmMs} ms`);
}

// ---------------------------------------------------------------------------------------------
// 8. Size report.
// ---------------------------------------------------------------------------------------------
step('Payload');
const modulesDir = join(appDir, 'node_modules');
const largest = readdirSync(modulesDir, { withFileTypes: true })
  .flatMap((entry) => (entry.name.startsWith('@')
    ? readdirSync(join(modulesDir, entry.name)).map((scoped) => `${entry.name}/${scoped}`)
    : [entry.name]))
  .map((name) => ({ name, bytes: sizeOf(join(modulesDir, name)) }))
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 15);

for (const { name, bytes } of largest) console.log(`  ${mb(bytes).padStart(9)}  ${name}`);
const total = sizeOf(outDir);
console.log(`\n  node.exe   ${mb(sizeOf(nodeExe))}`);
console.log(`  app        ${mb(prunedSize)}`);
console.log(`  TOTAL      ${mb(total)}`);
summary.push(`Payload ${mb(total)}, down from ${mb(rawSize + sizeOf(nodeExe))} before pruning`);

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### JobTrack ${version} payload\n\n${summary.map((line) => `- ${line}`).join('\n')}\n\n` +
      `| package | size |\n| --- | --- |\n${largest.map(({ name, bytes }) => `| ${name} | ${mb(bytes)} |`).join('\n')}\n`,
    { flag: 'a' },
  );
}
console.log('\nPayload built.');
