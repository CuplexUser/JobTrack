/**
 * Openings ranked by how well they fit the user's profile, and postings scored before they
 * are saved.
 *
 * The scoring itself is the pure `scoreFit` in `@jobtrack/shared`; this module fetches the
 * profile, asks the search index how close each posting reads to the profile summary, and
 * sorts. Without a profile every fit is null and a list keeps its usual newest-first order.
 */

import {
  hasFitCriteria,
  scoreFit,
  type FitPosting,
  type FitProfile,
  type FitResult,
  type JobOpeningView,
  type OpeningFilter,
  type PostingToScore,
  type RankedOpening,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import type { SearchIndex } from '../search/index.js';
import { listOpenings } from './openings.service.js';
import { getProfile } from './settings.service.js';

type SimilaritySource = Pick<SearchIndex, 'similarityBetween'> | null;

/** A posting to score, saved or not. The company only feeds the summary comparison. */
export interface ScorablePosting extends FitPosting {
  companyName: string | null;
}

async function scoreAgainst(
  profile: FitProfile,
  search: SimilaritySource,
  postings: readonly ScorablePosting[],
): Promise<(FitResult | null)[]> {
  if (!hasFitCriteria(profile)) return postings.map(() => null);

  // What a posting says about itself: the title carries the most, the description (kept in
  // `notes` once saved) the rest.
  const similarities =
    profile.summary && search && postings.length > 0
      ? await search.similarityBetween(
          profile.summary,
          postings.map((posting) => [posting.jobTitle, posting.companyName, posting.notes].filter(Boolean).join('. ')),
        )
      : null;

  return postings.map((posting, index) => scoreFit(profile, posting, similarities?.[index] ?? null));
}

/**
 * Fit for postings that may not be saved anywhere, such as ones an assistant found and is
 * deciding whether to suggest. Results line up with the input; all null without a profile.
 */
export async function scorePostings(
  repos: Repos,
  search: SimilaritySource,
  postings: readonly ScorablePosting[],
): Promise<(FitResult | null)[]> {
  return scoreAgainst(await getProfile(repos), search, postings);
}

/** One opening with its fit alongside, for the single-record reads and writes. */
export async function fitOpening(
  repos: Repos,
  search: SimilaritySource,
  opening: JobOpeningView,
): Promise<RankedOpening> {
  const [fit] = await scorePostings(repos, search, [{ ...opening, companyName: opening.company.name }]);
  return { ...opening, fit: fit ?? null };
}

export interface ScoredPosting {
  /** Where the posting sat in the request, since the results come back reordered. */
  index: number;
  companyName: string | null;
  jobTitle: string;
  fit: FitResult | null;
}

export interface PostingScores {
  /** False when there is no profile to score against; every fit is then null. */
  hasProfile: boolean;
  /**
   * Whether the posting text was compared to the profile summary. False without a summary,
   * or while the model is loading, and the scores then rest on the rules alone.
   */
  summaryCompared: boolean;
  /** Best first; equal scores keep the order they were sent in. */
  postings: ScoredPosting[];
}

/** Postings that are not saved, scored and ranked best first. Nothing is stored. */
export async function rankPostings(
  repos: Repos,
  search: SimilaritySource,
  postings: readonly PostingToScore[],
): Promise<PostingScores> {
  const fits = await scorePostings(
    repos,
    search,
    postings.map(({ description, ...posting }) => ({ ...posting, notes: description })),
  );
  const scored = postings.map((posting, index) => ({
    index,
    companyName: posting.companyName,
    jobTitle: posting.jobTitle,
    fit: fits[index] ?? null,
  }));
  scored.sort((a, b) => (b.fit?.score ?? -1) - (a.fit?.score ?? -1));
  return {
    hasProfile: fits.some((fit) => fit !== null),
    summaryCompared: fits.some((fit) => fit?.semanticUsed === true),
    postings: scored,
  };
}

export async function rankOpenings(
  repos: Repos,
  search: SimilaritySource,
  filter: Partial<OpeningFilter> = {},
): Promise<RankedOpening[]> {
  const [openings, profile] = await Promise.all([listOpenings(repos, filter), getProfile(repos)]);
  const fits = await scoreAgainst(
    profile,
    search,
    openings.map((opening) => ({ ...opening, companyName: opening.company.name })),
  );

  let ranked: RankedOpening[] = openings.map((opening, index) => ({ ...opening, fit: fits[index] ?? null }));

  if (!hasFitCriteria(profile)) return ranked;
  if (filter.minFit !== undefined) {
    ranked = ranked.filter((opening) => (opening.fit?.score ?? 0) >= filter.minFit!);
  }
  if (filter.sort === 'fit') {
    // Stable, so openings with the same score keep their newest-first order.
    ranked.sort((a, b) => (b.fit?.score ?? -1) - (a.fit?.score ?? -1));
  }
  return ranked;
}
