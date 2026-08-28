/**
 * This package's own name and version — what `npm ls -g jobtrack` prints, what the tray menu
 * shows, and what the composed server reports from `GET /api/meta`. Read from `package.json`
 * at runtime for the same reason `@jobtrack/api` does it (see its `version.ts`): this package
 * ships TypeScript sources, so there is no build step to bake a constant into.
 *
 * Deliberately not routed through `assets.ts`: that file resolves assets this package
 * doesn't own the source of, and falls back to a sibling monorepo path when a staged copy
 * is missing. `package.json` is this package's own, always sits one level above `src/`, and
 * npm includes it in every tarball regardless of the `files` list.
 */

import { createRequire } from 'node:module';

const { name, version } = createRequire(import.meta.url)('../package.json') as {
  name: string;
  version: string;
};

export const APP_PACKAGE = { name, version };
export const APP_VERSION = version;
