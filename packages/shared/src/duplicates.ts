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

/**
 * The other direction: not "is this new one a duplicate?" but "which records already in
 * the database are duplicates of each other?".
 *
 * Same rules as `evaluateDuplicates` — one company, titles that are identical once
 * normalized or close enough by wording — so the sweep cannot disagree with the check the
 * form runs while you type. Deliberately *not* semantic: this one exists to drive
 * deletions, and a group a person cannot explain by looking at it is a group they should
 * not be asked to act on.
 */
export interface DuplicateCandidate {
  id: string;
  companyId: string;
  jobTitle: string;
  titleKey: string;
  appliedOn: string;
  status: ApplicationStatus;
  createdAt: string;
}

export interface DuplicateGroup<T extends DuplicateCandidate = DuplicateCandidate> {
  companyId: string;
  /** 'exact' when every title normalizes to one key, 'similar' when only close. */
  kind: 'exact' | 'similar';
  /** Strongest-to-keep first — see `keepRank`. Always at least two. */
  members: T[];
}

/**
 * How much a record is worth keeping when two describe the same application.
 *
 * A record that got somewhere — or recorded an outcome — is the one with the history
 * attached. A bare "applied" is what an accidental second entry looks like.
 */
const STATUS_KEEP_WEIGHT: Record<ApplicationStatus, number> = {
  offer: 5,
  interview: 4,
  screening: 3,
  rejected: 2,
  withdrawn: 2,
  ghosted: 2,
  applied: 1,
};

export interface GroupDuplicatesOptions<T> {
  titleThreshold?: number;
  /**
   * How much else a record carries — notes, tags, filled-in fields. Ties on status are
   * broken by this, so the fuller of two identical rows is the one kept. The caller
   * supplies it because what counts as "filled in" is not this module's business.
   */
  richness?: (item: T) => number;
}

/**
 * Cluster applications that look like repeats of each other.
 *
 * Grouping is transitive within a company: A joins the group it matches, so a run of three
 * near-identical titles comes back as one group of three rather than three overlapping
 * pairs. Companies are never crossed — a different employer is a different application,
 * however similar the title.
 */
export function groupDuplicates<T extends DuplicateCandidate>(
  candidates: readonly T[],
  options: GroupDuplicatesOptions<T> = {},
): DuplicateGroup<T>[] {
  const titleThreshold = options.titleThreshold ?? TITLE_SIMILARITY_THRESHOLD;
  const richness = options.richness ?? (() => 0);

  const byCompany = new Map<string, T[]>();
  for (const candidate of candidates) {
    if (!candidate.titleKey) continue; // nothing to compare on
    const list = byCompany.get(candidate.companyId) ?? [];
    list.push(candidate);
    byCompany.set(candidate.companyId, list);
  }

  const groups: DuplicateGroup<T>[] = [];

  for (const [companyId, list] of byCompany) {
    if (list.length < 2) continue;

    const clusters: T[][] = [];
    for (const candidate of list) {
      const home = clusters.find((cluster) =>
        cluster.some(
          (member) =>
            member.titleKey === candidate.titleKey ||
            diceCoefficient(member.titleKey, candidate.titleKey) >= titleThreshold,
        ),
      );
      if (home) home.push(candidate);
      else clusters.push([candidate]);
    }

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      // Best keeper first: furthest along, then fullest, then the one that was there
      // first — a stable order, so the same scan always recommends the same record.
      const members = [...cluster].sort(
        (a, b) =>
          STATUS_KEEP_WEIGHT[b.status] - STATUS_KEEP_WEIGHT[a.status] ||
          richness(b) - richness(a) ||
          a.appliedOn.localeCompare(b.appliedOn) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );

      const kind = cluster.every((member) => member.titleKey === cluster[0]!.titleKey)
        ? 'exact'
        : 'similar';
      groups.push({ companyId, kind, members });
    }
  }

  // Exact repeats first — they are the ones that need no judgment — then the most recent,
  // since a duplicate you created lately is the one you still remember creating.
  return groups.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'exact' ? -1 : 1;
    return newestOf(b).localeCompare(newestOf(a));
  });
}

function newestOf<T extends DuplicateCandidate>(group: DuplicateGroup<T>): string {
  return group.members.reduce((newest, member) => (member.appliedOn > newest ? member.appliedOn : newest), '');
}
