/**
 * The join replacement.
 *
 * repolayer has no relations, so assembling an application together with its company, its
 * tags and its note count is this module's job. The rule it exists to enforce is that the
 * cost stays *constant in the page size*: three queries for fifty applications, not
 * fifty-one. Every list endpoint goes through here, so there is exactly one place where an
 * accidental N+1 could be introduced, and it is a place with tests pointed at it.
 */

import type { Company, JobApplication, JobApplicationView, Tag } from '@jobtrack/shared';
import type { Repos } from './repos.js';
import type { ApplicationRow } from './schema.js';
import { toApplication, toCompany, toTag } from './mappers.js';

/** Distinct, non-empty values — what every batched `in` filter is built from. */
export function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Look up many rows by id in one query.
 *
 * The empty-array guard is not just an optimization: an `in` with no values matches
 * nothing by design, so skipping the round trip is free, and it keeps an empty page from
 * touching the database at all.
 */
async function byIds<T extends { id: string }>(
  repo: { findMany(query: object): Promise<T[]> },
  ids: readonly string[],
): Promise<Map<string, T>> {
  if (ids.length === 0) return new Map();
  const rows = await repo.findMany({ where: [{ field: 'id', op: 'in', value: [...ids] }] });
  return new Map(rows.map((row) => [row.id, row]));
}

/** Tags for many targets of one kind, resolved through the polymorphic junction table. */
export async function tagsForTargets(
  repos: Repos,
  targetType: 'application' | 'company',
  targetIds: readonly string[],
): Promise<Map<string, Tag[]>> {
  const result = new Map<string, Tag[]>();
  if (targetIds.length === 0) return result;

  const links = await repos.tagLinks.findMany({
    where: [
      { field: 'targetType', op: 'eq', value: targetType },
      { field: 'targetId', op: 'in', value: [...targetIds] },
    ],
  });
  if (links.length === 0) return result;

  const tagRows = await byIds(repos.tags, uniqueIds(links.map((l) => l.tagId)));

  for (const link of links) {
    const row = tagRows.get(link.tagId);
    if (!row) continue; // a link whose tag was deleted; ignore rather than fail the page
    const list = result.get(link.targetId) ?? [];
    list.push(toTag(row));
    result.set(link.targetId, list);
  }

  for (const list of result.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/** How many notes hang off each of these targets. */
export async function noteCountsForTargets(
  repos: Repos,
  targetType: 'application' | 'company',
  targetIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (targetIds.length === 0) return counts;

  const notes = await repos.notes.findMany({
    where: [
      { field: 'targetType', op: 'eq', value: targetType },
      { field: 'targetId', op: 'in', value: [...targetIds] },
    ],
  });

  for (const note of notes) {
    if (!note.targetId) continue;
    counts.set(note.targetId, (counts.get(note.targetId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Turn a page of application rows into the shape the UI renders.
 *
 * Three queries total, whatever the page size: companies by id, tag links plus their tags,
 * and notes for the count. A company that has somehow gone missing yields a placeholder
 * rather than dropping the application, because losing a row from a list silently is worse
 * than showing one with an unknown employer.
 */
export async function hydrateApplications(
  repos: Repos,
  rows: readonly ApplicationRow[],
): Promise<JobApplicationView[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [companyRows, tagsByApp, noteCounts] = await Promise.all([
    byIds(repos.companies, uniqueIds(rows.map((r) => r.companyId))),
    tagsForTargets(repos, 'application', ids),
    noteCountsForTargets(repos, 'application', ids),
  ]);

  return rows.map((row) => {
    const companyRow = companyRows.get(row.companyId);
    const company: Company = companyRow
      ? toCompany(companyRow)
      : missingCompany(row.companyId);

    return {
      ...toApplication(row),
      company,
      tags: tagsByApp.get(row.id) ?? [],
      noteCount: noteCounts.get(row.id) ?? 0,
    } satisfies JobApplicationView;
  });
}

function missingCompany(id: string): Company {
  const now = new Date(0).toISOString();
  return {
    id,
    name: '(unknown company)',
    nameKey: '',
    website: null,
    location: null,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Single-row convenience built on the batched path, so there is only one code path. */
export async function hydrateApplication(
  repos: Repos,
  row: ApplicationRow,
): Promise<JobApplicationView> {
  const [view] = await hydrateApplications(repos, [row]);
  if (!view) throw new Error(`hydrateApplications returned nothing for ${row.id}`);
  return view;
}

export type { JobApplication };
