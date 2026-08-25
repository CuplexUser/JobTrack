/**
 * Companies.
 *
 * The important operation here is `resolveCompany`: the application form lets you type an
 * employer's name freely, and this is what decides whether that name is a company you
 * already track or a new one. Getting it right is what makes duplicate detection work at
 * all — if "Spotify AB" and "Spotify" become two rows, no amount of title matching will
 * notice you have applied there twice.
 */

import { UniqueConstraintError } from 'repolayer';
import {
  companyKey,
  displayName,
  isActiveStatus,
  type Company,
  type CompanyWithStats,
  type ApplicationStatus,
  type Tag,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import { toCompany, toStatus } from '../db/mappers.js';
import type { CompanyRow } from '../db/schema.js';
import { formatDateOnly } from '@jobtrack/shared';
import { tagsForTargets } from '../db/hydrate.js';
import { applyTagNames } from './tags.service.js';

/** Look up a company by typed name, without creating anything. */
export async function findCompanyByName(
  repos: Repos,
  name: string,
): Promise<CompanyRow | null> {
  const key = companyKey(name);
  if (!key) return null;
  return repos.companies.findOne({ where: { nameKey: key } });
}

/**
 * Find the company for this typed name, creating it if it is genuinely new.
 *
 * Must be called inside a transaction by anything that also writes an application, so a
 * failed application does not leave a stray company behind.
 */
export async function resolveCompany(repos: Repos, name: string): Promise<CompanyRow> {
  const display = displayName(name);
  const key = companyKey(display);
  if (!key) throw new Error('Company name cannot be empty');

  const existing = await repos.companies.findOne({ where: { nameKey: key } });
  if (existing) return existing;

  try {
    return await repos.companies.create({
      name: display,
      nameKey: key,
      website: null,
      location: null,
      archived: false,
    });
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    const found = await repos.companies.findOne({ where: { nameKey: key } });
    if (!found) throw error;
    return found;
  }
}

export async function getCompany(repos: Repos, id: string): Promise<Company | null> {
  const row = await repos.companies.findById(id);
  return row ? toCompany(row) : null;
}

/** The company plus its tags — what the company page needs to render its tag editor. */
export async function getCompanyWithTags(
  repos: Repos,
  id: string,
): Promise<(Company & { tags: Tag[] }) | null> {
  const row = await repos.companies.findById(id);
  if (!row) return null;
  const tags = await tagsForTargets(repos, 'company', [id]);
  return { ...toCompany(row), tags: tags.get(id) ?? [] };
}

/**
 * Every company with the counts the list view shows.
 *
 * Deliberately one read of the applications table rather than a count query per company:
 * repolayer has no GROUP BY, so N companies would otherwise mean N `count()` round trips
 * for an answer a single pass can produce.
 */
export async function listCompanies(
  repos: Repos,
  options: { includeArchived?: boolean; search?: string } = {},
): Promise<CompanyWithStats[]> {
  const where: Record<string, unknown>[] = [];
  if (!options.includeArchived) where.push({ field: 'archived', op: 'eq', value: false });
  if (options.search) {
    where.push({ field: 'name', op: 'ilike', value: `%${escapeLike(options.search)}%` });
  }

  const rows = await repos.companies.findMany({
    ...(where.length > 0 ? { where: where as never } : {}),
    orderBy: [{ field: 'name', direction: 'asc' }],
  });
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [applications, tagsByCompany] = await Promise.all([
    repos.applications.findMany({
      where: [{ field: 'companyId', op: 'in', value: ids }],
    }),
    tagsForTargets(repos, 'company', ids),
  ]);

  const stats = new Map<string, { total: number; active: number; last: string | null }>();
  for (const app of applications) {
    const entry = stats.get(app.companyId) ?? { total: 0, active: 0, last: null };
    entry.total += 1;
    if (isActiveStatus(toStatus(app.status))) entry.active += 1;
    const appliedOn = formatDateOnly(app.appliedOn);
    if (entry.last === null || appliedOn > entry.last) entry.last = appliedOn;
    stats.set(app.companyId, entry);
  }

  return rows.map((row) => {
    const entry = stats.get(row.id);
    return {
      ...toCompany(row),
      tags: tagsByCompany.get(row.id) ?? [],
      applicationCount: entry?.total ?? 0,
      activeCount: entry?.active ?? 0,
      lastAppliedOn: entry?.last ?? null,
    };
  });
}

export async function createCompany(
  repos: Repos,
  input: { name: string; website: string | null; location: string | null; tags: string[] },
): Promise<Company> {
  const display = displayName(input.name);
  const key = companyKey(display);
  if (!key) throw new Error('Company name cannot be empty');

  const row = await repos.companies.create({
    name: display,
    nameKey: key,
    website: input.website,
    location: input.location,
    archived: false,
  });
  await applyTagNames(repos, 'company', row.id, input.tags);
  return toCompany(row);
}

export async function updateCompany(
  repos: Repos,
  id: string,
  patch: {
    name?: string;
    website?: string | null;
    location?: string | null;
    archived?: boolean;
    tags?: string[];
  },
): Promise<Company> {
  const changes: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const display = displayName(patch.name);
    changes.name = display;
    changes.nameKey = companyKey(display);
  }
  if (patch.website !== undefined) changes.website = patch.website;
  if (patch.location !== undefined) changes.location = patch.location;
  if (patch.archived !== undefined) changes.archived = patch.archived;

  const row =
    Object.keys(changes).length > 0
      ? await repos.companies.update(id, changes as never)
      : await requireCompany(repos, id);

  if (patch.tags !== undefined) await applyTagNames(repos, 'company', id, patch.tags);
  return toCompany(row);
}

async function requireCompany(repos: Repos, id: string): Promise<CompanyRow> {
  const row = await repos.companies.findById(id);
  if (!row) throw new Error(`No company ${id}`);
  return row;
}

/**
 * Company name suggestions for the autocomplete, ranked so exact prefixes come first.
 *
 * This is the first line of duplicate defence: offering "Spotify" while someone types
 * "spot" is what stops a second spelling being created in the first place.
 */
export async function suggestCompanies(
  repos: Repos,
  query: string,
  limit = 8,
): Promise<CompanyWithStats[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const rows = await repos.companies.findMany({
    where: [{ field: 'name', op: 'ilike', value: `%${escapeLike(trimmed)}%` }],
    limit: 50,
  });
  if (rows.length === 0) return [];

  const key = companyKey(trimmed);
  const counts = await countsByCompany(
    repos,
    rows.map((r) => r.id),
  );

  return rows
    .map((row) => ({
      ...toCompany(row),
      tags: [],
      applicationCount: counts.get(row.id)?.total ?? 0,
      activeCount: counts.get(row.id)?.active ?? 0,
      lastAppliedOn: counts.get(row.id)?.last ?? null,
    }))
    .sort((a, b) => rank(a.nameKey, key) - rank(b.nameKey, key) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function rank(candidate: string, typed: string): number {
  if (candidate === typed) return 0;
  if (candidate.startsWith(typed)) return 1;
  return 2;
}

async function countsByCompany(
  repos: Repos,
  ids: readonly string[],
): Promise<Map<string, { total: number; active: number; last: string | null }>> {
  const result = new Map<string, { total: number; active: number; last: string | null }>();
  if (ids.length === 0) return result;

  const applications = await repos.applications.findMany({
    where: [{ field: 'companyId', op: 'in', value: [...ids] }],
  });
  for (const app of applications) {
    const entry = result.get(app.companyId) ?? { total: 0, active: 0, last: null };
    entry.total += 1;
    if (isActiveStatus(toStatus(app.status) as ApplicationStatus)) entry.active += 1;
    const appliedOn = formatDateOnly(app.appliedOn);
    if (entry.last === null || appliedOn > entry.last) entry.last = appliedOn;
    result.set(app.companyId, entry);
  }
  return result;
}

/**
 * Neutralize LIKE wildcards in user input.
 *
 * `%` and `_` are wildcards, so searching for "100% Remote" would otherwise match nearly
 * everything. Backslash-escaping is not available: that only works alongside a trailing
 * `ESCAPE '\'` clause, and repolayer binds the pattern as a plain parameter with nowhere
 * to put one. So each wildcard becomes `_`, which matches exactly one character —
 * including the literal `%` that was typed. Marginally over-permissive, and correct.
 */
export function escapeLike(value: string): string {
  return value.replace(/[%_]/g, '_');
}
