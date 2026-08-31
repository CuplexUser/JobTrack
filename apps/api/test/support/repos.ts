/**
 * A complete `Repos` bundle backed by `MemoryRepo`.
 *
 * The factory itself lives in `src/db/memory-repos.ts` now — it's also the demo build's
 * data layer, not just the test suite's — and is re-exported here so existing test imports
 * keep working unchanged.
 */

import { SearchIndex } from '../../src/search/index.js';
import { FakeEmbedder } from '../../src/search/embedder.js';
import type { RepoBundle } from '../../src/db/repos.js';
import type { Config } from '../../src/config.js';
import type { Deps } from '../../src/deps.js';

import { createMemoryRepos } from '../../src/db/memory-repos.js';

export { createMemoryRepos };

/**
 * A search index over the in-memory repos using the deterministic fake embedder, so tests
 * exercise the real fusion and caching paths without downloading a model.
 */
export function createTestSearch(repos: RepoBundle): SearchIndex {
  return new SearchIndex({ repos, embedder: new FakeEmbedder() });
}

/**
 * A `Config` for tests that need to stand up the whole Fastify app.
 *
 * Written out rather than calling `loadConfig()`, which reads the real environment and
 * would generate an api-token file in the repo. The token here is a fixed string so a test
 * can assert on it.
 */
export function testConfig(over: Partial<Config> = {}): Config {
  return {
    driver: 'sqlite',
    databaseFile: ':memory:',
    databaseUrl: undefined,
    host: '127.0.0.1',
    port: 3001,
    modelCacheDir: '.models',
    embeddingModel: 'test',
    semanticSearchEnabled: false,
    dbTargets: [{ name: 'default', driver: 'sqlite' }],
    activeDbTarget: 'default',
    dataDir: '.',
    corsOrigins: ['http://localhost:5173'],
    apiToken: 'test-token',
    ...over,
  };
}

/** The whole dependency bundle a route needs, over in-memory everything. */
export function testDeps(over: { config?: Partial<Config> } = {}): Deps {
  const repos = createMemoryRepos();
  return {
    repos,
    search: createTestSearch(repos),
    config: testConfig(over.config ?? {}),
  };
}

/** The defaults every application test starts from, so each test states only what it varies. */
export function applicationInput(over: Record<string, unknown> = {}) {
  return {
    companyName: 'Spotify',
    jobTitle: 'Backend Engineer',
    appliedOn: '2026-03-12',
    status: 'applied' as const,
    jobUrl: null,
    location: 'Stockholm',
    workMode: 'hybrid',
    sourceName: 'LinkedIn',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    followUpOn: null,
    tags: [] as string[],
    notes: null,
    ...over,
  };
}

/** The defaults every opening test starts from. */
export function openingInput(over: Record<string, unknown> = {}) {
  return {
    companyName: 'Spotify',
    jobTitle: 'Backend Engineer',
    jobUrl: null,
    location: 'Stockholm',
    workMode: 'hybrid',
    sourceName: 'LinkedIn',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    notes: null,
    ...over,
  };
}
