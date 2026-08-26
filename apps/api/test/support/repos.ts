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

export { createMemoryRepos } from '../../src/db/memory-repos.js';

/**
 * A search index over the in-memory repos using the deterministic fake embedder, so tests
 * exercise the real fusion and caching paths without downloading a model.
 */
export function createTestSearch(repos: RepoBundle): SearchIndex {
  return new SearchIndex({ repos, embedder: new FakeEmbedder() });
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
