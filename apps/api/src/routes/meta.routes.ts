/**
 * What the running server actually is: which package and version is serving, and the
 * database driver it booted against. All three are fixed for the life of the process, so
 * this is the one route with nothing to read from `repos`.
 *
 * The package reported is whichever entry point built the app (`buildApp`'s `app` option),
 * not necessarily this one: when the tray is what's running it passes `jobtrack` instead,
 * because that's the package a user installs, the one `npm ls -g` prints, and therefore the
 * one a bug report should quote. The name ships alongside the version precisely so those two
 * cases can't be mistaken for each other — a dev server on `@jobtrack/api` and an installed
 * tray legitimately report different numbers.
 */

import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import type { PackageIdentity } from '../version.js';

export async function metaRoutes(
  app: FastifyInstance,
  deps: Deps,
  pkg: PackageIdentity,
): Promise<void> {
  app.get('/api/meta', async () => ({
    name: pkg.name,
    version: pkg.version,
    driver: deps.config.driver,
  }));
}
