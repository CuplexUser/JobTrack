/**
 * The `Repos` contract every service is written against.
 *
 * Deliberately expressed in terms of `Repo<T>` rather than any one driver, which is what
 * lets a service be handed the in-memory fake in tests — or in the client-side demo build —
 * with no ceremony at all. The multi-driver factory that builds a real `Repos` bundle lives
 * in `create-repos.ts`, not here: that file imports `repolayer`'s `createRepo`, which
 * dynamically imports each driver (SQLite, Postgres, MySQL) in turn, and none of that
 * belongs in a browser bundle. `repolayer`'s own types (`Repo`, `TxContext`) are used only
 * as types below, so nothing in this file pulls that machinery in either — see
 * `db/memory-repos.ts` and `apps/web/src/api/demo-client.ts` for where that separation pays
 * off.
 */

import type { Repo, TxContext } from 'repolayer';
import type {
  ApplicationRow,
  CompanyRow,
  JobOpeningRow,
  NoteRow,
  SearchVectorRow,
  StatusEventRow,
  TagLinkRow,
  TagRow,
} from './schema.js';

export interface Repos {
  companies: Repo<CompanyRow>;
  applications: Repo<ApplicationRow>;
  tags: Repo<TagRow>;
  tagLinks: Repo<TagLinkRow>;
  notes: Repo<NoteRow>;
  statusEvents: Repo<StatusEventRow>;
  searchVectors: Repo<SearchVectorRow>;
  jobOpenings: Repo<JobOpeningRow>;
}

export interface RepoBundle extends Repos {
  close(): Promise<void>;
}

/**
 * Rebind every repo to a transaction.
 *
 * Creating an application can create its company and several tags at the same time; if any
 * of that fails, none of it should survive. repolayer expresses this with `repo.with(ctx)`,
 * and this helper saves every service from threading the context through by hand. Passing
 * `undefined` returns the bundle unchanged, so a service can take an optional context and
 * work identically inside or outside a transaction.
 */
export function scopedRepos(repos: Repos, ctx: TxContext | undefined): Repos {
  if (!ctx) return repos;
  return {
    companies: repos.companies.with(ctx),
    applications: repos.applications.with(ctx),
    tags: repos.tags.with(ctx),
    tagLinks: repos.tagLinks.with(ctx),
    notes: repos.notes.with(ctx),
    statusEvents: repos.statusEvents.with(ctx),
    searchVectors: repos.searchVectors.with(ctx),
    jobOpenings: repos.jobOpenings.with(ctx),
  };
}
