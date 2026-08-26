/**
 * Server entry point.
 *
 * Order matters here: the database opens, the lexical index builds, the server starts
 * answering — and only then does the embedding model load, in the background. Waiting on a
 * 25 MB download before the first request would be a poor trade for a local app.
 */

import { loadConfig } from './config.js';
import { createRepos } from './db/create-repos.js';
import { buildApp } from './app.js';
import { SearchIndex } from './search/index.js';
import { DisabledEmbedder, type Embedder } from './search/embedder.js';
import { TransformersEmbedder } from './search/transformers-embedder.js';

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

await search.start();

await app.listen({ host: config.host, port: config.port });
console.log(`JobTrack API on http://${config.host}:${config.port} (driver: ${config.driver})`);
if (config.semanticSearchEnabled) {
  console.log('[search] lexical index ready; embedding model loading in the background');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      search.stop();
      await app.close();
      await repos.close();
      process.exit(0);
    })();
  });
}
