/**
 * Resolves read-only files this package needs but doesn't own the source of: the built web
 * UI, and a template `.env.example`. Prefers a copy staged inside this package (see
 * scripts/stage-assets.mjs, which the `prepack` script runs before `npm publish`/`npm pack`)
 * and falls back to the sibling location in this monorepo, for local development before that
 * staging step has ever run.
 *
 * Distinct from `resolveAppDataDir` in `@jobtrack/api/config`: that's where *user* data lives
 * (the database, the model cache); this is where the package's own *shipped* assets live.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
/** Only exists in a monorepo checkout — never present in a published, installed package. */
const monorepoRoot = resolve(here, '../../..');

function resolveAsset(bundledRelative: string, monorepoRelative: string): string | undefined {
  const bundled = resolve(packageRoot, bundledRelative);
  if (existsSync(bundled)) return bundled;
  const monorepo = resolve(monorepoRoot, monorepoRelative);
  if (existsSync(monorepo)) return monorepo;
  return undefined;
}

export function resolveWebDist(): string | undefined {
  return resolveAsset('vendor/web-dist', 'apps/web/dist');
}

export function resolveEnvExample(): string | undefined {
  return resolveAsset('vendor/.env.example', '.env.example');
}
