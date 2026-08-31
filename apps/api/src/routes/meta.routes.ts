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

  /**
   * "Is this token the right one?" — and nothing else.
   *
   * By the time a request reaches here the guard has already required a valid token
   * (`TOKEN_ONLY_PATHS` in `lib/request-guard.ts`), so reaching the handler at all *is* the
   * answer; a wrong or missing one was refused with a 403.
   *
   * It exists because the honest answer was otherwise unavailable to a browser: every other
   * route can be reached for reasons that have nothing to do with credentials, and the
   * extension's setup page was reporting success for any token typed into it.
   */
  app.get('/api/auth/check', async () => ({ ok: true }));
}
