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
import { dashboardRoutes } from './routes/dashboard.routes.js';

export async function buildApp(deps: Deps, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // Per-request access logs are noise for a single-user local app, so the level is
    // raised rather than using the deprecated `disableRequestLogging` flag. Warnings and
    // errors still come through, and index.ts prints its own startup line.
    logger: options.logger ? { level: 'warn' } : false,
  });

  await app.register(cors, { origin: true });

  registerErrorHandler(app);

  await app.register(async (instance) => applicationRoutes(instance, deps));
  await app.register(async (instance) => companyRoutes(instance, deps));
  await app.register(async (instance) => tagRoutes(instance, deps));
  await app.register(async (instance) => noteRoutes(instance, deps));
  await app.register(async (instance) => searchRoutes(instance, deps));
  await app.register(async (instance) => exportRoutes(instance, deps));
  await app.register(async (instance) => dashboardRoutes(instance, deps));

  return app;
}
