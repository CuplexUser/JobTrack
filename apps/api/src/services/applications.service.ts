/**
 * Applications — the center of the app.
 *
 * Two invariants live here and nowhere else:
 *
 * 1. **`periodYear`/`periodMonth` are always derived from `appliedOn`.** Every write goes
 *    through `periodFields()`, so the year/month navigation can never disagree with the
 *    date on the record.
 * 2. **A status change always writes a status event.** The timeline is not a separate
 *    feature you can forget to update; it is a consequence of changing the status.
 */

import type { Filter, QueryOptions, TxContext } from 'repolayer';
import {
  ACTIVE_STATUSES,
  parseDateOnly,
  titleKey as toTitleKey,
  toPeriod,
  todayDateOnly,
  type ApplicationFilter,
  type ApplicationStatus,
  type JobApplicationDetail,
  type JobApplicationView,
  type Period,
} from '@jobtrack/shared';
import { scopedRepos, type Repos } from '../db/repos.js';
import type { ApplicationRow } from '../db/schema.js';
import { toNote, toStatusEvent } from '../db/mappers.js';
import { hydrateApplication, hydrateApplications } from '../db/hydrate.js';
import { resolveCompany, escapeLike } from './companies.service.js';
import { applyTagNames, applicationIdsWithAllTags } from './tags.service.js';

export interface ListResult {
  items: JobApplicationView[];
  cursor: string | null;
  hasMore: boolean;
  total: number;
}

/** The single definition of how a date becomes the denormalized period columns. */
function periodFields(appliedOn: string): { appliedOn: Date; periodYear: number; periodMonth: number } {
  const date = parseDateOnly(appliedOn);
  const period = toPeriod(date);
  return { appliedOn: date, periodYear: period.year, periodMonth: period.month };
}

/**
 * Translate the shared filter object into repolayer's query shape.
 *
 * Everything here stays inside the portable eleven operators, which is what keeps the
 * Postgres swap honest — there is no dialect-specific predicate anywhere in this app.
 */
function buildWhere(
  filter: ApplicationFilter,
  restrictToIds: string[] | null,
): Filter<ApplicationRow>[] {
  const where: Filter<ApplicationRow>[] = [];

  if (filter.archived !== 'all') {
    where.push({ field: 'archived', op: 'eq', value: filter.archived });
  }
  if (filter.year !== undefined) {
    where.push({ field: 'periodYear', op: 'eq', value: filter.year });
  }
  if (filter.month !== undefined) {
    where.push({ field: 'periodMonth', op: 'eq', value: filter.month });
  }
  if (filter.companyId) {
    where.push({ field: 'companyId', op: 'eq', value: filter.companyId });
  }
  if (filter.status && filter.status.length > 0) {
    where.push({ field: 'status', op: 'in', value: [...filter.status] });
  }
  if (filter.workMode && filter.workMode.length > 0) {
    where.push({ field: 'workMode', op: 'in', value: [...filter.workMode] });
  }
  if (filter.source) {
    where.push({ field: 'sourceName', op: 'ilike', value: `%${escapeLike(filter.source)}%` });
  }
  if (filter.from) {
    where.push({ field: 'appliedOn', op: 'gte', value: parseDateOnly(filter.from) });
  }
  if (filter.to) {
    where.push({ field: 'appliedOn', op: 'lte', value: parseDateOnly(filter.to) });
  }
  if (filter.followUpDue) {
    // "Due" means the date has arrived and the conversation is still live — a follow-up on
    // a rejected application is not something anyone needs reminding about.
    where.push({ field: 'followUpOn', op: 'isNull', value: false });
    where.push({ field: 'followUpOn', op: 'lte', value: parseDateOnly(todayDateOnly()) });
    where.push({ field: 'status', op: 'in', value: [...ACTIVE_STATUSES] });
  }
  if (restrictToIds !== null) {
    where.push({ field: 'id', op: 'in', value: restrictToIds });
  }

  return where;
}

/** Sorts that the database can do. `company` is not one of them — see listApplications. */
const SORT_FIELDS = {
  appliedOn: 'appliedOn',
  jobTitle: 'jobTitle',
  status: 'status',
  createdAt: 'createdAt',
} as const;

export interface ListOptions {
  /**
   * Ranked ids from a search. When present the database ordering is ignored and results
   * come back in this order, because relevance is not something a SQL sort can express.
   */
  orderedIds?: string[] | null;
}

export async function listApplications(
  repos: Repos,
  filter: ApplicationFilter,
  options: ListOptions = {},
): Promise<ListResult> {
  // A tag filter means "has all of these", which needs the junction table resolved first.
  const tagIds = await applicationIdsWithAllTags(repos, filter.tags);
  const orderedIds = options.orderedIds ?? null;

  let restrictToIds: string[] | null = tagIds;
  if (orderedIds !== null) {
    restrictToIds = tagIds === null ? orderedIds : orderedIds.filter((id) => tagIds.includes(id));
  }
  // An empty restriction matches nothing; short-circuit rather than sending `in ()`.
  if (restrictToIds !== null && restrictToIds.length === 0) {
    return { items: [], cursor: null, hasMore: false, total: 0 };
  }

  const where = buildWhere(filter, restrictToIds);
  const query: QueryOptions<ApplicationRow> = where.length > 0 ? { where } : {};

  // Relevance order and company order both have to happen in memory: one because the
  // database has no idea what relevance is, the other because sorting by a column in
  // another table is a join, and repolayer has none.
  if (orderedIds !== null || filter.sort === 'company') {
    return listInMemory(repos, query, filter, orderedIds);
  }

  const sortField = SORT_FIELDS[filter.sort as keyof typeof SORT_FIELDS] ?? 'appliedOn';
  const page = await repos.applications.findPage(
    { ...query, orderBy: [{ field: sortField, direction: filter.direction }] },
    { limit: filter.limit, ...(filter.cursor ? { after: filter.cursor } : {}) },
  );

  const [items, total] = await Promise.all([
    hydrateApplications(repos, page.items),
    repos.applications.count(query),
  ]);

  return { items, cursor: page.cursor, hasMore: page.hasMore, total };
}

/**
 * The non-keyset path: read every match, order it here, then slice.
 *
 * Acceptable because this is a personal tracker whose table is measured in hundreds of
 * rows, and because the alternative — denormalizing the company name onto every
 * application so it can be sorted in SQL — trades a real correctness risk (two copies of
 * a name that can drift) for a performance win nobody here would notice.
 */
async function listInMemory(
  repos: Repos,
  query: QueryOptions<ApplicationRow>,
  filter: ApplicationFilter,
  orderedIds: string[] | null,
): Promise<ListResult> {
  const rows = await repos.applications.findMany(query);
  const items = await hydrateApplications(repos, rows);

  if (orderedIds !== null) {
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    items.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  } else {
    const direction = filter.direction === 'asc' ? 1 : -1;
    items.sort((a, b) => a.company.name.localeCompare(b.company.name) * direction);
  }

  // Offset paging is fine here: the whole result set is already in hand, so there is no
  // page-shifting to worry about.
  const offset = filter.cursor ? Number(filter.cursor) || 0 : 0;
  const slice = items.slice(offset, offset + filter.limit);
  const nextOffset = offset + slice.length;

  return {
    items: slice,
    cursor: nextOffset < items.length ? String(nextOffset) : null,
    hasMore: nextOffset < items.length,
    total: items.length,
  };
}

/** Every match, unpaged — what the exports iterate. */
export async function findAllMatching(
  repos: Repos,
  filter: ApplicationFilter,
): Promise<JobApplicationView[]> {
  const tagIds = await applicationIdsWithAllTags(repos, filter.tags);
  if (tagIds !== null && tagIds.length === 0) return [];

  const where = buildWhere(filter, tagIds);
  const sortField = SORT_FIELDS[filter.sort as keyof typeof SORT_FIELDS] ?? 'appliedOn';

  const rows = await repos.applications.findMany({
    ...(where.length > 0 ? { where } : {}),
    orderBy: [{ field: sortField, direction: filter.direction }],
  });

  const items = await hydrateApplications(repos, rows);
  if (filter.sort === 'company') {
    const direction = filter.direction === 'asc' ? 1 : -1;
    items.sort((a, b) => a.company.name.localeCompare(b.company.name) * direction);
  }
  return items;
}

export async function getApplication(
  repos: Repos,
  id: string,
): Promise<JobApplicationDetail | null> {
  const row = await repos.applications.findById(id);
  if (!row) return null;

  const [view, events, notes] = await Promise.all([
    hydrateApplication(repos, row),
    repos.statusEvents.findMany({
      where: { applicationId: id },
      orderBy: [
        { field: 'occurredOn', direction: 'asc' },
        { field: 'createdAt', direction: 'asc' },
      ],
    }),
    repos.notes.findMany({
      where: { targetType: 'application', targetId: id },
      orderBy: [
        { field: 'pinned', direction: 'desc' },
        { field: 'updatedAt', direction: 'desc' },
      ],
    }),
  ]);

  return {
    ...view,
    statusEvents: events.map(toStatusEvent),
    notes: notes.map(toNote),
  };
}

export interface CreateApplicationData {
  companyName: string;
  jobTitle: string;
  appliedOn: string;
  status: ApplicationStatus;
  jobUrl: string | null;
  location: string | null;
  workMode: string;
  sourceName: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  followUpOn: string | null;
  tags: string[];
  notes: string | null;
}

/**
 * Create an application, its company if new, its tags, its opening status event and its
 * first note — all inside one transaction, so a half-written application cannot exist.
 */
export async function createApplication(
  repos: Repos,
  data: CreateApplicationData,
): Promise<JobApplicationView> {
  const created = await repos.applications.withTransaction(async (_tx, ctx: TxContext) => {
    const scoped = scopedRepos(repos, ctx);
    const company = await resolveCompany(scoped, data.companyName);

    const row = await scoped.applications.create({
      companyId: company.id,
      jobTitle: data.jobTitle,
      titleKey: toTitleKey(data.jobTitle),
      ...periodFields(data.appliedOn),
      status: data.status,
      jobUrl: data.jobUrl,
      location: data.location,
      workMode: data.workMode,
      sourceName: data.sourceName,
      salaryMin: data.salaryMin,
      salaryMax: data.salaryMax,
      salaryCurrency: data.salaryCurrency,
      followUpOn: data.followUpOn ? parseDateOnly(data.followUpOn) : null,
      archived: false,
    });

    await scoped.statusEvents.create({
      applicationId: row.id,
      fromStatus: null,
      toStatus: data.status,
      occurredOn: parseDateOnly(data.appliedOn),
      commentText: null,
    });

    if (data.tags.length > 0) {
      await applyTagNames(scoped, 'application', row.id, data.tags);
    }

    if (data.notes) {
      await scoped.notes.create({
        title: `Notes — ${data.jobTitle}`,
        body: data.notes,
        targetType: 'application',
        targetId: row.id,
        pinned: false,
      });
    }

    return row;
  });

  return hydrateApplication(repos, created);
}

export interface PatchApplicationData {
  companyName?: string;
  jobTitle?: string;
  appliedOn?: string;
  status?: ApplicationStatus;
  statusComment?: string | null;
  jobUrl?: string | null;
  location?: string | null;
  workMode?: string;
  sourceName?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  followUpOn?: string | null;
  archived?: boolean;
  tags?: string[];
}

export async function patchApplication(
  repos: Repos,
  id: string,
  patch: PatchApplicationData,
): Promise<JobApplicationView | null> {
  const existing = await repos.applications.findById(id);
  if (!existing) return null;

  const updated = await repos.applications.withTransaction(async (_tx, ctx: TxContext) => {
    const scoped = scopedRepos(repos, ctx);
    const changes: Record<string, unknown> = {};

    if (patch.companyName !== undefined) {
      changes.companyId = (await resolveCompany(scoped, patch.companyName)).id;
    }
    if (patch.jobTitle !== undefined) {
      changes.jobTitle = patch.jobTitle;
      changes.titleKey = toTitleKey(patch.jobTitle);
    }
    if (patch.appliedOn !== undefined) Object.assign(changes, periodFields(patch.appliedOn));
    if (patch.jobUrl !== undefined) changes.jobUrl = patch.jobUrl;
    if (patch.location !== undefined) changes.location = patch.location;
    if (patch.workMode !== undefined) changes.workMode = patch.workMode;
    if (patch.sourceName !== undefined) changes.sourceName = patch.sourceName;
    if (patch.salaryMin !== undefined) changes.salaryMin = patch.salaryMin;
    if (patch.salaryMax !== undefined) changes.salaryMax = patch.salaryMax;
    if (patch.salaryCurrency !== undefined) changes.salaryCurrency = patch.salaryCurrency;
    if (patch.followUpOn !== undefined) {
      changes.followUpOn = patch.followUpOn ? parseDateOnly(patch.followUpOn) : null;
    }
    if (patch.archived !== undefined) changes.archived = patch.archived;

    // A status change is never just a column write — it earns a row in the timeline.
    if (patch.status !== undefined && patch.status !== existing.status) {
      changes.status = patch.status;
      await scoped.statusEvents.create({
        applicationId: id,
        fromStatus: existing.status,
        toStatus: patch.status,
        occurredOn: parseDateOnly(todayDateOnly()),
        commentText: patch.statusComment ?? null,
      });
    }

    const row =
      Object.keys(changes).length > 0
        ? await scoped.applications.update(id, changes as never)
        : existing;

    if (patch.tags !== undefined) {
      await applyTagNames(scoped, 'application', id, patch.tags);
    }
    return row;
  });

  return hydrateApplication(repos, updated);
}

/** Advance or correct the status, recording when it happened and why. */
export async function changeStatus(
  repos: Repos,
  id: string,
  input: { status: ApplicationStatus; occurredOn?: string; comment: string | null },
): Promise<JobApplicationView | null> {
  const existing = await repos.applications.findById(id);
  if (!existing) return null;

  const updated = await repos.applications.withTransaction(async (_tx, ctx: TxContext) => {
    const scoped = scopedRepos(repos, ctx);
    await scoped.statusEvents.create({
      applicationId: id,
      fromStatus: existing.status,
      toStatus: input.status,
      occurredOn: parseDateOnly(input.occurredOn ?? todayDateOnly()),
      commentText: input.comment,
    });
    return scoped.applications.update(id, { status: input.status } as never);
  });

  return hydrateApplication(repos, updated);
}

/**
 * Delete an application and everything hanging off it.
 *
 * repolayer has no cascading deletes, so the tag links, notes, status events and search
 * vector all have to go explicitly. Doing it in a transaction means a failure part-way
 * cannot leave the orphans behind.
 */
export async function deleteApplication(repos: Repos, id: string): Promise<boolean> {
  const existing = await repos.applications.findById(id);
  if (!existing) return false;

  await repos.applications.withTransaction(async (_tx, ctx: TxContext) => {
    const scoped = scopedRepos(repos, ctx);
    await scoped.tagLinks.deleteMany({ where: { targetType: 'application', targetId: id } });
    await scoped.notes.deleteMany({ where: { targetType: 'application', targetId: id } });
    await scoped.statusEvents.deleteMany({ where: { applicationId: id } });
    await scoped.searchVectors.deleteMany({ where: { targetType: 'application', targetId: id } });
    await scoped.applications.delete(id);
  });

  return true;
}

export interface PeriodNode extends Period {
  count: number;
  months?: PeriodNode[];
}

/**
 * The year/month tree for the sidebar.
 *
 * One read, tallied in memory. repolayer offers no GROUP BY, and asking `count()` once per
 * period would be dozens of round trips for something a single pass answers — the tradeoff
 * is that this reads whole rows, since the query shape has no column projection either.
 */
export async function computePeriods(
  repos: Repos,
  options: { includeArchived?: boolean } = {},
): Promise<PeriodNode[]> {
  const rows = await repos.applications.findMany(
    options.includeArchived ? {} : { where: { archived: false } },
  );

  const years = new Map<number, Map<number, number>>();
  for (const row of rows) {
    const months = years.get(row.periodYear) ?? new Map<number, number>();
    months.set(row.periodMonth, (months.get(row.periodMonth) ?? 0) + 1);
    years.set(row.periodYear, months);
  }

  return [...years.entries()]
    .sort((a, b) => b[0] - a[0]) // newest year first
    .map(([year, months]) => ({
      year,
      month: 0, // a year node covers every month
      count: [...months.values()].reduce((sum, n) => sum + n, 0),
      months: [...months.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([month, count]) => ({ year, month, count })),
    }));
}
