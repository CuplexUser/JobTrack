/**
 * "Have I applied here before?" — decided as a pure function so it can be unit-tested
 * exhaustively and reused verbatim by the live check in the form, the confirm-on-save
 * modal, and the dashboard's standalone lookup.
 */

import type { ApplicationStatus } from './types.js';
import { diceCoefficient } from './similarity.js';
import { titleKey } from './normalize.js';

/**
 * Above this, two job titles are "the same role written differently".
 * Tuned so "Backend Engineer" vs "Backend Engineer II" matches, while "Backend Engineer"
 * vs "Frontend Engineer" — which share a great deal of text — does not.
 */
export const TITLE_SIMILARITY_THRESHOLD = 0.8;

/** Above this, two titles mean the same thing even when the words differ entirely. */
export const SEMANTIC_SIMILARITY_THRESHOLD = 0.75;

export type DuplicateVerdict = 'exact' | 'similar' | 'company' | 'none';

export interface PriorApplication {
  id: string;
  jobTitle: string;
  titleKey: string;
  appliedOn: string;
  status: ApplicationStatus;
  /** Cosine similarity to the candidate title. Null when the embedder is not ready yet. */
  semanticSimilarity?: number | null;
}

export interface DuplicateMatch extends PriorApplication {
  matchKind: 'exact' | 'similar';
  titleSimilarity: number;
  semanticSimilarity: number | null;
}

export interface DuplicateCheck {
  verdict: DuplicateVerdict;
  /** True when the company itself is already known, whatever the titles say. */
  companyMatched: boolean;
  /** Strongest first. Empty unless the verdict is `exact` or `similar`. */
  matches: DuplicateMatch[];
  /** How many applications exist at this company in total. */
  priorCount: number;
}

/**
 * Compare a candidate job title against every prior application at the same company.
 *
 * `priors` is expected to be already scoped to one company — deciding *which* company the
 * typed name refers to is the caller's job, because that lookup needs the database.
 */
export function evaluateDuplicates(
  candidateTitle: string,
  priors: readonly PriorApplication[],
  options: {
    titleThreshold?: number;
    semanticThreshold?: number;
  } = {},
): DuplicateCheck {
  const titleThreshold = options.titleThreshold ?? TITLE_SIMILARITY_THRESHOLD;
  const semanticThreshold = options.semanticThreshold ?? SEMANTIC_SIMILARITY_THRESHOLD;

  const candidateKey = titleKey(candidateTitle);
  const companyMatched = priors.length > 0;

  if (!candidateKey || priors.length === 0) {
    return {
      verdict: companyMatched ? 'company' : 'none',
      companyMatched,
      matches: [],
      priorCount: priors.length,
    };
  }

  const matches: DuplicateMatch[] = [];

  for (const prior of priors) {
    const semantic = prior.semanticSimilarity ?? null;
    const titleSimilarity = diceCoefficient(candidateKey, prior.titleKey);

    if (prior.titleKey === candidateKey) {
      matches.push({ ...prior, matchKind: 'exact', titleSimilarity: 1, semanticSimilarity: semantic });
      continue;
    }

    const similarByText = titleSimilarity >= titleThreshold;
    const similarByMeaning = semantic !== null && semantic >= semanticThreshold;

    if (similarByText || similarByMeaning) {
      matches.push({ ...prior, matchKind: 'similar', titleSimilarity, semanticSimilarity: semantic });
    }
  }

  matches.sort((a, b) => {
    // Exact matches always lead — they are the ones that block a save.
    if (a.matchKind !== b.matchKind) return a.matchKind === 'exact' ? -1 : 1;
    const strengthA = Math.max(a.titleSimilarity, a.semanticSimilarity ?? 0);
    const strengthB = Math.max(b.titleSimilarity, b.semanticSimilarity ?? 0);
    if (strengthA !== strengthB) return strengthB - strengthA;
    return a.appliedOn < b.appliedOn ? 1 : -1; // most recent first
  });

  const verdict: DuplicateVerdict = matches.some((m) => m.matchKind === 'exact')
    ? 'exact'
    : matches.length > 0
      ? 'similar'
      : 'company';

  return { verdict, companyMatched, matches, priorCount: priors.length };
}

/** Whether a verdict should interrupt the user rather than merely inform them. */
export function shouldBlockSave(verdict: DuplicateVerdict): boolean {
  return verdict === 'exact';
}
