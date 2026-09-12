/**
 * "Have I applied here before?" — and its counterpart, "which of these did I enter twice?"
 *
 * The flow: resolve the typed company name to a company (without creating one), read every
 * application at that company, optionally score the typed title against them semantically,
 * and hand all of it to the pure `evaluateDuplicates` in the shared package.
 *
 * `findDuplicateGroups` runs the same rules over everything already stored, so the
 * duplicates page and the form's live check can never disagree about what a duplicate is.
 *
 * The split matters. Everything judgmental — thresholds, ranking, what counts as exact —
 * is pure and unit-tested. This module only fetches.
 */

import {
  applicationFilterSchema,
  evaluateDuplicates,
  groupDuplicates,
  titleKey,
  formatDateOnly,
  type Company,
  type ContactView,
  type DuplicateCheck,
  type DuplicateMatch,
  type JobApplicationView,
  type PriorApplication,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import { toCompany, toStatus } from '../db/mappers.js';
import { findAllMatching } from './applications.service.js';
import { findCompanyByName } from './companies.service.js';
import { contactsAtCompany } from './contacts.service.js';

/** How many people at the company a check reports. The rest are on the company page. */
export const CONTACTS_IN_CHECK = 10;

/**
 * People worth mentioning first: a recruiter or someone who could refer you beats a
 * connection accepted years ago, and someone you actually talk to beats someone you don't.
 */
function closestFirst(a: ContactView, b: ContactView): number {
  const weight = (contact: ContactView) => (contact.relationship === 'connection' ? 1 : 0);
  return (
    weight(a) - weight(b) ||
    (b.lastInteractionOn ?? '').localeCompare(a.lastInteractionOn ?? '') ||
    a.name.localeCompare(b.name)
  );
}

/** The people the user knows at a company, closest first, capped for a result that travels. */
export async function knownContacts(repos: Repos, companyName: string): Promise<ContactView[]> {
  const contacts = await contactsAtCompany(repos, companyName);
  return contacts.sort(closestFirst).slice(0, CONTACTS_IN_CHECK);
}
import type { SearchIndex } from '../search/index.js';

export interface DuplicateCheckResult extends DuplicateCheck {
  /** The company the typed name resolved to, or null when it is genuinely new. */
  company: Company | null;
  /** False when the model was not ready, so matching used text similarity alone. */
  semanticUsed: boolean;
  /**
   * People the user knows at this employer, closest first. Present even when the company is
   * new to JobTrack, since knowing someone there matters most before a first application.
   */
  contacts: ContactView[];
}

export async function checkDuplicates(
  repos: Repos,
  search: SearchIndex | null,
  input: { company: string; title: string; excludeId?: string },
): Promise<DuplicateCheckResult> {
  const [companyRow, contacts] = await Promise.all([
    findCompanyByName(repos, input.company),
    knownContacts(repos, input.company),
  ]);

  if (!companyRow) {
    return {
      verdict: 'none',
      companyMatched: false,
      matches: [],
      priorCount: 0,
      company: null,
      semanticUsed: false,
      contacts,
    };
  }

  const rows = await repos.applications.findMany({
    where: { companyId: companyRow.id },
    orderBy: [{ field: 'appliedOn', direction: 'desc' }],
  });

  // When editing, an application must not report itself as its own duplicate.
  const priorRows = input.excludeId ? rows.filter((row) => row.id !== input.excludeId) : rows;

  // Semantic scoring is a bonus, not a requirement: without it, `evaluateDuplicates` still
  // catches exact and textually-similar titles.
  let similarities = new Map<string, number>();
  let semanticUsed = false;
  if (search && input.title.trim() && priorRows.length > 0) {
    similarities = await search.similarityTo(
      `${input.title} at ${companyRow.name}`,
      priorRows.map((row) => row.id),
    );
    semanticUsed = similarities.size > 0;
  }

  const priors: PriorApplication[] = priorRows.map((row) => ({
    id: row.id,
    jobTitle: row.jobTitle,
    titleKey: row.titleKey || titleKey(row.jobTitle),
    appliedOn: formatDateOnly(row.appliedOn),
    status: toStatus(row.status),
    semanticSimilarity: similarities.get(row.id) ?? null,
  }));

  const check = evaluateDuplicates(input.title, priors);

  return { ...check, company: toCompany(companyRow), semanticUsed, contacts };
}

/** One cluster of records that look like the same application, ready to act on. */
export interface DuplicateGroupView {
  companyId: string;
  companyName: string;
  kind: 'exact' | 'similar';
  /** The record the scan recommends keeping — always `members[0]`. */
  keepId: string;
  members: JobApplicationView[];
}

export interface DuplicateScan {
  groups: DuplicateGroupView[];
  /** How many applications were compared, so the UI can say "nothing found" honestly. */
  scanned: number;
}

/**
 * How much a record carries beyond the bare minimum, used to break a tie between two
 * records at the same status: the one with the notes, tags and filled-in fields is the one
 * worth keeping.
 */
function richnessOf(view: JobApplicationView): number {
  const filled = [
    view.jobUrl,
    view.location,
    view.sourceName,
    view.salaryMin,
    view.salaryMax,
    view.followUpOn,
  ].filter((value) => value !== null && value !== '').length;
  return view.noteCount + view.tags.length + filled;
}

/**
 * Sweep the whole database for applications that duplicate each other.
 *
 * Archived records are included on purpose: a duplicate is a data problem whatever its
 * archive state, and hiding half a pair would make the remaining one look legitimate.
 */
export async function findDuplicateGroups(repos: Repos): Promise<DuplicateScan> {
  const applications = await findAllMatching(
    repos,
    applicationFilterSchema.parse({ archived: 'all' }),
  );

  const groups = groupDuplicates(
    applications.map((view) => ({
      ...view,
      titleKey: view.titleKey || titleKey(view.jobTitle),
    })),
    { richness: richnessOf },
  );

  return {
    scanned: applications.length,
    groups: groups.map((group) => ({
      companyId: group.companyId,
      companyName: group.members[0]!.company.name,
      kind: group.kind,
      keepId: group.members[0]!.id,
      members: group.members,
    })),
  };
}

export type { DuplicateMatch };
