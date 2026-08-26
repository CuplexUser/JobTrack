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
import { loadConfig, type Config } from '@jobtrack/api/config';
import { createRepos } from '@jobtrack/api/db/create-repos';
import type { RepoBundle } from '@jobtrack/api/db/repos';
import { SearchIndex } from '@jobtrack/api/search';
import { DisabledEmbedder, type Embedder } from '@jobtrack/api/search/embedder';
import { TransformersEmbedder } from '@jobtrack/api/search/transformers-embedder';
import { resolveWebDist } from './assets.js';

export interface RunningServer {
  app: FastifyInstance;
  config: Config;
  repos: RepoBundle;
  search: SearchIndex;
}

export async function startServer(): Promise<RunningServer> {
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

  const app = await buildApp({ repos, search, config }, { logger: true });

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
  await app.listen({ host: config.host, port: config.port });

  return { app, config, repos, search };
}
