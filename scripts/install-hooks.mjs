/**
 * Points git at the repo's tracked hooks in `.githooks/` (currently a pre-push check that a
 * release-bound change has its version bump, see scripts/bump-versions.mjs). Run by the root
 * `prepare` script on `npm install`. Does nothing outside a git checkout, such as a source
 * tarball, and never fails the install.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (existsSync(join(repoRoot, '.git'))) {
  const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) console.warn(`Could not install git hooks: ${(result.stderr ?? '').trim() || 'git not found'}`);
}
