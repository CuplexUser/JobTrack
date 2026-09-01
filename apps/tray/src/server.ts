/**
 * Composes the existing API app with static serving for the built web UI, so the tray manages
 * one process instead of two. Mirrors apps/api/src/index.ts's startup sequence (config, repos,
 * search, then listen) but adds @fastify/static + an SPA fallback on top of the same
 * `buildApp` every other entry point (API server, tests) uses — the JSON API itself is
 * unchanged, including its 404 behavior for `/api/*`.
 */
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@jobtrack/api/app';
import { loadConfig, loadEnvFile, type Config } from '@jobtrack/api/config';
import { createRepos } from '@jobtrack/api/db/create-repos';
import type { RepoBundle } from '@jobtrack/api/db/repos';
import { SearchIndex } from '@jobtrack/api/search';
import { DisabledEmbedder, type Embedder } from '@jobtrack/api/search/embedder';
import { TransformersEmbedder } from '@jobtrack/api/search/transformers-embedder';
import { resolveWebDist } from './assets.js';
import { APP_PACKAGE } from './version.js';

/**
 * Exit code for "the port is taken". Distinct from a generic crash so a supervisor can tell a
 * misconfiguration it should surface to the user from a fault it should just retry.
 */
export const EXIT_PORT_IN_USE = 3;

export interface RunningServer {
  app: FastifyInstance;
  config: Config;
  repos: RepoBundle;
  search: SearchIndex;
}

export async function startServer(): Promise<RunningServer> {
  // The file the tray's "Open App Settings" menu item edits — read here, or that menu
  // item is a text editor pointed at nothing.
  loadEnvFile();
  const config = loadConfig();
  const repos = await createRepos(config);

  const embedder: Embedder = config.semanticSearchEnabled
    ? new TransformersEmbedder({
        model: config.embeddingModel,
        cacheDir: config.modelCacheDir,
        onError: (error) => {
          console.warn('[search] semantic model unavailable, staying lexical-only:', error);
        },
      })
    : new DisabledEmbedder();

  const search = new SearchIndex({
    repos,
    embedder,
    log: (message, error) => console.warn(`[search] ${message}`, error ?? ''),
  });

  // `app` so /api/meta — and the web UI's About card — report the `jobtrack` package the
  // user installed, rather than the @jobtrack/api version underneath it.
  const app = await buildApp({ repos, search, config }, { logger: true, app: APP_PACKAGE });

  const webDist = resolveWebDist();
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist });
    // React Router routes (e.g. /applications, /companies/:id) are only real files at
    // `/`; anything else that isn't an API call falls back to index.html so client-side
    // routing can take over.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'not_found', message: 'Not found' });
    });
  } else {
    console.warn('[tray] no built web UI found — run "npm run build" to serve it. API-only for now.');
  }

  await search.start();

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    // Overwhelmingly this is a second JobTrack — autostart plus a manual launch. Left alone it
    // surfaces as an unhandled rejection and a stack trace; a supervisor (and a person) can do
    // something useful with a named cause and a distinct exit code.
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    console.error(
      `JOBTRACK_ERROR ${JSON.stringify({ code: 'EADDRINUSE', host: config.host, port: config.port })}`,
    );
    console.error(
      `Port ${config.port} is already in use — JobTrack may already be running. Stop it, or set PORT in .env to something else.`,
    );
    search.stop();
    await app.close();
    await repos.close();
    process.exit(EXIT_PORT_IN_USE);
  }

  return { app, config, repos, search };
}
