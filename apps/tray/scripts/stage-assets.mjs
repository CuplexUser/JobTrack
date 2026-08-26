/**
 * Stages the files this package needs but doesn't own the source of, into `vendor/`, so
 * `npm publish`/`npm pack` includes a real, standalone copy alongside `bin/` and `src/`.
 * Runs automatically via the `prepack` script — see src/assets.ts for how the app finds
 * these at runtime, preferring this staged copy over the sibling monorepo location.
 *
 * Maintainer-only: never runs for someone who just `npm install`s the published package.
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const repoRoot = resolve(packageRoot, '../..');
const vendorDir = resolve(packageRoot, 'vendor');

console.log('[stage-assets] building the web UI (npm run build)...');
execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });

rmSync(vendorDir, { recursive: true, force: true });
mkdirSync(vendorDir, { recursive: true });

// Sourcemaps are dev-only debugging aids (vite.config.ts always emits them) and dwarf the
// rest of the bundle — dropping them here cuts the published tarball by several MB.
cpSync(resolve(repoRoot, 'apps/web/dist'), resolve(vendorDir, 'web-dist'), {
  recursive: true,
  filter: (src) => !src.endsWith('.map'),
});
cpSync(resolve(repoRoot, '.env.example'), resolve(vendorDir, '.env.example'));

console.log(`[stage-assets] staged into ${vendorDir}`);
