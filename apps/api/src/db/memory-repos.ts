/**
 * A complete `Repos` bundle backed by `MemoryRepo`.
 *
 * This is the payoff for building on repolayer: the services take a `Repos` and cannot
 * tell the difference, so the entire service layer runs with no database at all — no
 * fixture files, no cleanup, and (via `repolayer/memory`, which has no Node built-ins) no
 * reason it couldn't run in a browser. `MemoryRepo` is trustworthy for this because it
 * passes the same conformance suite as the SQLite adapter — filters, null ordering, unique
 * constraints, transactions and keyset paging all behave the way a real engine behaves.
 *
 * One `MemoryStore` is shared by every repo, which is what lets `repo.with(ctx)` span
 * tables the way it does over a real connection. Used by the test suite
 * (`test/support/repos.ts`) and by the client-side demo build (`@jobtrack/web`'s
 * `demo-client.ts`) alike, so the two never drift into two different in-memory data layers.
 */

import { MemoryRepo, MemoryStore } from 'repolayer/memory';
import type { RepoBundle } from './repos.js';
import {
  applicationSchema,
  companySchema,
  jobOpeningSchema,
  noteSchema,
  searchVectorSchema,
  statusEventSchema,
  tagLinkSchema,
  tagSchema,
} from './schema.js';

export function createMemoryRepos(): RepoBundle {
  const store = new MemoryStore();
  // Matches src/db/repos.ts exactly. The shorthand `timestamps: true` is deliberately not
  // used: MemoryRepo does not honor it, which would make every hydrated row here carry
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
    jobOpenings: new MemoryRepo({ ...common, table: 'job_openings', schema: jobOpeningSchema }),
  } as unknown as RepoBundle;

  return { ...repos, close: async () => {} };
}
