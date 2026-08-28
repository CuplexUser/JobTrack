/**
 * The Fastify application.
 *
 * Built as a function over its dependencies rather than reaching for module-level
 * singletons, so a test can stand up a complete server over MemoryRepo and a fake embedder
 * and exercise the real routes.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Deps } from './deps.js';
import { registerErrorHandler } from './lib/errors.js';
import { applicationRoutes } from './routes/applications.routes.js';
import { companyRoutes } from './routes/companies.routes.js';
import { tagRoutes } from './routes/tags.routes.js';
import { noteRoutes } from './routes/notes.routes.js';
import { searchRoutes } from './routes/search.routes.js';
import { exportRoutes } from './routes/export.routes.js';
import { importRoutes } from './routes/import.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { openingRoutes } from './routes/openings.routes.js';
import { backupRoutes } from './routes/backup.routes.js';
import { dbRoutes } from './routes/db.routes.js';
import { metaRoutes } from './routes/meta.routes.js';
import { API_PACKAGE, type PackageIdentity } from './version.js';

export interface BuildAppOptions {
  logger?: boolean;
  /**
   * Which package `GET /api/meta` reports as the running build. Defaults to this one —
   * correct when `index.ts` is the entry point — but the tray overrides it with its own,
   * since `jobtrack` is what a user installs and runs.
   */
  app?: PackageIdentity;
}

export async function buildApp(deps: Deps, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // Per-request access logs are noise for a single-user local app, so the level is
    // raised rather than using the deprecated `disableRequestLogging` flag. Warnings and
    // errors still come through, and index.ts prints its own startup line.
    logger: options.logger ? { level: 'warn' } : false,
  });

  await app.register(cors, { origin: true });

  // Every other route posts JSON, which Fastify parses by default. Import posts a raw file
  // instead — read as a Buffer rather than sniffed, so the route sees exactly the bytes the
  // browser sent regardless of what content type it decided the file was.
  app.addContentTypeParser(
    [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Backup uploads: xor-obfuscated gzip, see backup/codec.ts.
      'application/octet-stream',
    ],
    { parseAs: 'buffer' },
    (_request, payload, done) => done(null, payload),
  );

  registerErrorHandler(app);

  await app.register(async (instance) => applicationRoutes(instance, deps));
  await app.register(async (instance) => companyRoutes(instance, deps));
  await app.register(async (instance) => tagRoutes(instance, deps));
  await app.register(async (instance) => noteRoutes(instance, deps));
  await app.register(async (instance) => searchRoutes(instance, deps));
  await app.register(async (instance) => exportRoutes(instance, deps));
  await app.register(async (instance) => importRoutes(instance, deps));
  await app.register(async (instance) => dashboardRoutes(instance, deps));
  await app.register(async (instance) => openingRoutes(instance, deps));
  await app.register(async (instance) => backupRoutes(instance, deps));
  await app.register(async (instance) => dbRoutes(instance, deps));
  await app.register(async (instance) => metaRoutes(instance, deps, options.app ?? API_PACKAGE));

  return app;
}
