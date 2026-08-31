/**
 * Job openings — opportunities saved for later.
 *
 * Deliberately thin next to `applications.service.ts`: no status pipeline, no tags, no
 * linked notes, because the whole point is to capture something in ten seconds when you do
 * not yet have (or want to spend) what a real application record needs. `convertOpening` is
 * the bridge back: it builds the same `CreateApplicationData` the New Application form
 * would and hands it to `createApplication`, so a converted opening is validated and stored
 * exactly like one entered by hand — company resolution, the opening status event, the
 * linked note, all included.
 */

import type { TxContext } from 'repolayer';
import {
  canonicalJobUrl,
  companyKey,
  displayName,
  parseDateOnly,
  titleKey,
  todayDateOnly,
  type ApplicationStatus,
  type JobApplicationView,
  type JobOpeningView,
} from '@jobtrack/shared';
import { scopedRepos, type Repos } from '../db/repos.js';
import type { JobOpeningRow } from '../db/schema.js';
import { toCompany, toOpening } from '../db/mappers.js';
import { missingCompany } from '../db/hydrate.js';
import { findCompanyByName, resolveCompany } from './companies.service.js';
import { createApplication, type CreateApplicationData } from './applications.service.js';

async function hydrateOpening(repos: Repos, row: JobOpeningRow): Promise<JobOpeningView> {
  const companyRow = await repos.companies.findById(row.companyId);
  return { ...toOpening(row), company: companyRow ? toCompany(companyRow) : missingCompany(row.companyId) };
}

export async function listOpenings(
  repos: Repos,
  options: { includeArchived?: boolean } = {},
): Promise<JobOpeningView[]> {
  const rows = await repos.jobOpenings.findMany({
    ...(options.includeArchived ? {} : { where: { archived: false } }),
    orderBy: [{ field: 'savedOn', direction: 'desc' }],
  });
  if (rows.length === 0) return [];

  const companyIds = [...new Set(rows.map((r) => r.companyId))];
  const companies = await repos.companies.findMany({
    where: [{ field: 'id', op: 'in', value: companyIds }],
  });
  const companyById = new Map(companies.map((c) => [c.id, toCompany(c)]));

  return rows.map((row) => ({
    ...toOpening(row),
    company: companyById.get(row.companyId) ?? missingCompany(row.companyId),
  }));
}

export async function getOpening(repos: Repos, id: string): Promise<JobOpeningView | null> {
  const row = await repos.jobOpenings.findById(id);
  if (!row) return null;
  return hydrateOpening(repos, row);
}

export interface OpeningIdentity {
  companyName: string;
  jobTitle: string;
  jobUrl: string | null;
}

/**
 * The opening this posting has already been saved as, if it has.
 *
 * "The same posting" is decided in two steps, and the order matters:
 *
 * - **Two links that canonicalize the same** is the same posting, full stop — that is the
 *   case the browser extension hits when the same tab is clipped twice.
 * - **Two links that differ** are two postings, even at the same company under the same
 *   title: the same role advertised in Stockholm and in Berlin is two ads, and saving both
 *   is the point of saving anything.
 * - Only when a link is missing on one side does the company-and-title comparison decide,
 *   which is what catches the same role captured once from a page and once by hand.
 *
 * Archived openings count. One archived because it became an application is the strongest
 * possible reason not to silently save a third copy of the same ad — the caller says so
 * rather than pretending nothing was found.
 */
export async function findMatchingOpening(
  repos: Repos,
  posting: OpeningIdentity,
): Promise<JobOpeningView | null> {
  const company = await findCompanyByName(repos, posting.companyName);
  // No company means no opening can be under it, so there is nothing to collide with.
  if (!company) return null;

  const rows = await repos.jobOpenings.findMany({
    where: { companyId: company.id },
    orderBy: [{ field: 'savedOn', direction: 'desc' }],
  });

  const url = posting.jobUrl ? canonicalJobUrl(posting.jobUrl) : null;
  const key = titleKey(posting.jobTitle);

  const match = rows.find((row) => {
    const rowUrl = row.jobUrl ? canonicalJobUrl(row.jobUrl) : null;
    if (url && rowUrl) return url === rowUrl;
    return key !== '' && titleKey(row.jobTitle) === key;
  });

  return match ? hydrateOpening(repos, match) : null;
}

export interface CreateOpeningData {
  companyName: string;
  jobTitle: string;
  jobUrl: string | null;
  location: string | null;
  workMode: string;
  sourceName: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  notes: string | null;
  savedOn?: string;
}

export async function createOpening(repos: Repos, data: CreateOpeningData): Promise<JobOpeningView> {
  const display = displayName(data.companyName);
  if (!companyKey(display)) throw new Error('Company name cannot be empty');

  const created = await repos.jobOpenings.withTransaction(async (_tx, ctx: TxContext) => {
    const scoped = scopedRepos(repos, ctx);
    const company = await resolveCompany(scoped, display);

    return scoped.jobOpenings.create({
      companyId: company.id,
      jobTitle: data.jobTitle,
      jobUrl: data.jobUrl,
      location: data.location,
      workMode: data.workMode,
      sourceName: data.sourceName,
      salaryMin: data.salaryMin,
      salaryMax: data.salaryMax,
      salaryCurrency: data.salaryCurrency,
      notes: data.notes,
      savedOn: parseDateOnly(data.savedOn ?? todayDateOnly()),
      archived: false,
      convertedApplicationId: null,
    });
  });

  return hydrateOpening(repos, created);
}

export interface PatchOpeningData {
  companyName?: string;
  jobTitle?: string;
  jobUrl?: string | null;
  location?: string | null;
  workMode?: string;
  sourceName?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  notes?: string | null;
  savedOn?: string;
  archived?: boolean;
}

export async function updateOpening(
  repos: Repos,
  id: string,
  patch: PatchOpeningData,
): Promise<JobOpeningView | null> {
  const existing = await repos.jobOpenings.findById(id);
  if (!existing) return null;

  const changes: Record<string, unknown> = {};
  if (patch.companyName !== undefined) {
    changes.companyId = (await resolveCompany(repos, patch.companyName)).id;
  }
  if (patch.jobTitle !== undefined) changes.jobTitle = patch.jobTitle;
  if (patch.jobUrl !== undefined) changes.jobUrl = patch.jobUrl;
  if (patch.location !== undefined) changes.location = patch.location;
  if (patch.workMode !== undefined) changes.workMode = patch.workMode;
  if (patch.sourceName !== undefined) changes.sourceName = patch.sourceName;
  if (patch.salaryMin !== undefined) changes.salaryMin = patch.salaryMin;
  if (patch.salaryMax !== undefined) changes.salaryMax = patch.salaryMax;
  if (patch.salaryCurrency !== undefined) changes.salaryCurrency = patch.salaryCurrency;
  if (patch.notes !== undefined) changes.notes = patch.notes;
  if (patch.savedOn !== undefined) changes.savedOn = parseDateOnly(patch.savedOn);
  if (patch.archived !== undefined) changes.archived = patch.archived;

  const row =
    Object.keys(changes).length > 0
      ? await repos.jobOpenings.update(id, changes as never)
      : existing;

  return hydrateOpening(repos, row);
}

export async function deleteOpening(repos: Repos, id: string): Promise<boolean> {
  const existing = await repos.jobOpenings.findById(id);
  if (!existing) return false;
  await repos.jobOpenings.delete(id);
  return true;
}

export interface ConvertOpeningInput {
  appliedOn?: string;
  status?: ApplicationStatus;
  tags?: string[];
}

/**
 * Turn a saved opening into a real application. The opening is kept, not deleted — marked
 * `archived` with `convertedApplicationId` set, so it drops out of the active list while
 * still answering "what did I end up doing about this one?".
 */
export async function convertOpening(
  repos: Repos,
  id: string,
  input: ConvertOpeningInput,
): Promise<JobApplicationView | null> {
  const opening = await repos.jobOpenings.findById(id);
  if (!opening) return null;

  const company = await repos.companies.findById(opening.companyId);
  if (!company) throw new Error(`Opening ${id} has no company`);

  const data: CreateApplicationData = {
    companyName: company.name,
    jobTitle: opening.jobTitle,
    appliedOn: input.appliedOn ?? todayDateOnly(),
    status: input.status ?? 'applied',
    jobUrl: opening.jobUrl,
    location: opening.location,
    workMode: opening.workMode,
    sourceName: opening.sourceName,
    salaryMin: opening.salaryMin,
    salaryMax: opening.salaryMax,
    salaryCurrency: opening.salaryCurrency,
    followUpOn: null,
    tags: input.tags ?? [],
    notes: opening.notes,
  };

  const created = await createApplication(repos, data);
  await repos.jobOpenings.update(id, {
    archived: true,
    convertedApplicationId: created.id,
  } as never);

  return created;
}
