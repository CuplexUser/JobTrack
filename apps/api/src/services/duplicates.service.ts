/**
 * "Have I applied here before?"
 *
 * The flow: resolve the typed company name to a company (without creating one), read every
 * application at that company, optionally score the typed title against them semantically,
 * and hand all of it to the pure `evaluateDuplicates` in the shared package.
 *
 * The split matters. Everything judgmental — thresholds, ranking, what counts as exact —
 * is pure and unit-tested. This module only fetches.
 */

import {
  evaluateDuplicates,
  titleKey,
  formatDateOnly,
  type Company,
  type DuplicateCheck,
  type DuplicateMatch,
  type PriorApplication,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import { toCompany, toStatus } from '../db/mappers.js';
import { findCompanyByName } from './companies.service.js';
import type { SearchIndex } from '../search/index.js';

export interface DuplicateCheckResult extends DuplicateCheck {
  /** The company the typed name resolved to, or null when it is genuinely new. */
  company: Company | null;
  /** False when the model was not ready, so matching used text similarity alone. */
  semanticUsed: boolean;
}

export async function checkDuplicates(
  repos: Repos,
  search: SearchIndex | null,
  input: { company: string; title: string; excludeId?: string },
): Promise<DuplicateCheckResult> {
  const companyRow = await findCompanyByName(repos, input.company);

  if (!companyRow) {
    return {
      verdict: 'none',
      companyMatched: false,
      matches: [],
      priorCount: 0,
      company: null,
      semanticUsed: false,
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

  return { ...check, company: toCompany(companyRow), semanticUsed };
}

export type { DuplicateMatch };
