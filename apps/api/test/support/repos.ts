/**
 * A complete `Repos` bundle backed by `MemoryRepo`.
 *
 * This is the payoff for building on repolayer: the services take a `Repos` and cannot
 * tell the difference, so the entire service layer is testable with no database, no
 * fixture files and no cleanup. `MemoryRepo` is trustworthy for this because it passes the
 * same conformance suite as the SQLite adapter — filters, null ordering, unique
 * constraints, transactions and keyset paging all behave the way a real engine behaves.
 *
 * One `MemoryStore` is shared by every repo, which is what lets `repo.with(ctx)` span
 * tables the way it does over a real connection.
 */

import { MemoryRepo, MemoryStore } from 'repolayer/memory';
import type { RepoBundle } from '../../src/db/repos.js';
import {
  applicationSchema,
  companySchema,
  noteSchema,
  searchVectorSchema,
  statusEventSchema,
  tagLinkSchema,
  tagSchema,
} from '../../src/db/schema.js';
import { SearchIndex } from '../../src/search/index.js';
import { FakeEmbedder } from '../../src/search/embedder.js';

export function createMemoryRepos(): RepoBundle {
  const store = new MemoryStore();
  // Matches src/db/repos.ts exactly. The shorthand `timestamps: true` is deliberately not
  // used: MemoryRepo does not honour it, which would make every hydrated row here carry
  // null timestamps that production never sees.
  const common = {
    store,
    ids: 'uuid',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  } as const;

  const repos = {
    companies: new MemoryRepo({ ...common, table: 'companies', schema: companySchema }),
    applications: new MemoryRepo({ ...common, table: 'job_applications', schema: applicationSchema }),
    tags: new MemoryRepo({ ...common, table: 'tags', schema: tagSchema }),
    tagLinks: new MemoryRepo({ ...common, table: 'tag_links', schema: tagLinkSchema }),
    notes: new MemoryRepo({ ...common, table: 'notes', schema: noteSchema }),
    statusEvents: new MemoryRepo({ ...common, table: 'status_events', schema: statusEventSchema }),
    searchVectors: new MemoryRepo({ ...common, table: 'search_vectors', schema: searchVectorSchema }),
  } as unknown as RepoBundle;

  return { ...repos, close: async () => {} };
}

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
