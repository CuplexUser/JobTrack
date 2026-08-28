/**
 * This package's own name and version, read from `package.json` at runtime rather than baked
 * in by a build step — `@jobtrack/api` ships as TypeScript sources (see the `exports` map in
 * package.json), so there is no build step to bake a constant into.
 *
 * Node loads this file from `src/`, so `../package.json` is the package root in both a
 * monorepo checkout and an installed copy. `createRequire` rather than a JSON import
 * attribute, which would tie this file to a specific module-resolution setting.
 */

import { createRequire } from 'node:module';

export interface PackageIdentity {
  name: string;
  version: string;
}

const { name, version } = createRequire(import.meta.url)('../package.json') as PackageIdentity;

export const API_PACKAGE: PackageIdentity = { name, version };
