/**
 * Openings ranked by how well they fit the user's profile, and postings scored before they
 * are saved.
 *
 * The scoring itself is the pure `scoreFit` in `@jobtrack/shared`; this module fetches the
 * profile and weights, asks the search index how close each posting reads to the profile
 * summary, and sorts. Without a profile every fit is null and a list keeps its usual
 * newest-first order.
 *
 * A saved opening's score is cached in the `fit_scores` table rather than recomputed on
 * every read — see `scoreOpenings` below for why that isn't just an optimization. Scoring a
 * posting that isn't saved (`scorePostings`/`rankPostings`, used before anything is stored)
 * has no row to cache into and stays a live computation.
 */

import {
  hasFitCriteria,
  scoreFit,
  type FitPosting,
  type FitProfile,
  type FitReason,
  type FitResult,
  type FitWeights,
  type JobOpeningView,
  type OpeningFilter,
  type PostingToScore,
  type RankedOpening,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import type { SearchIndex } from '../search/index.js';
import { listOpenings } from './openings.service.js';
import { getFitWeights, getProfile } from './settings.service.js';

type SimilaritySource = Pick<SearchIndex, 'similarityBetween' | 'embedderReady'> | null;

/** A posting to score, saved or not. The company only feeds the summary comparison. */
export interface ScorablePosting extends FitPosting {
  companyName: string | null;
}

function toScorable(opening: JobOpeningView): ScorablePosting {
  return { ...opening, companyName: opening.company.name };
}

async function scoreAgainst(
  profile: FitProfile,
  weights: FitWeights,
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

  return postings.map((posting, index) => scoreFit(profile, posting, similarities?.[index] ?? null, weights));
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
  const [profile, weights] = await Promise.all([getProfile(repos), getFitWeights(repos)]);
  return scoreAgainst(profile, weights, search, postings);
}

/**
 * Everything that decided a stored fit score, so a cached row can be trusted without
 * recomputing it: the opening's own fields, the profile, and the weights. Any of those
 * changing invalidates whatever it produced — the same "recompute only what changed" idea
 * `search/index.ts`'s `textHash` uses for embeddings.
 */
function fitFingerprint(profile: FitProfile, weights: FitWeights, posting: ScorablePosting): string {
  return JSON.stringify([profile, weights, posting]);
}

/**
 * Fit for saved openings, read from `fit_scores` when the stored row is still good for the
 * current profile, weights and opening, computed and persisted otherwise.
 *
 * This is what keeps a score identical wherever an opening is read. The web app and the MCP
 * server run as separate processes, each with its own in-memory search index and embedding
 * model (`search/index.ts`'s header explains why), so a score computed live on every read
 * could disagree between the two: whichever process's model happened to be loaded at request
 * time decides whether the semantic comparison counts, and that isn't the same moment in both
 * processes. Reading a stored value sidesteps the whole race — whichever process last wrote
 * it is what every reader sees, until the opening, the profile or the weights actually change.
 *
 * A row whose `semanticUsed` is false is also treated as stale once the embedder becomes
 * ready, even if nothing else changed, so a score computed keyword-only during a cold start
 * gets upgraded the next time anyone reads it rather than staying keyword-only forever.
 */
async function scoreOpenings(
  repos: Repos,
  search: SimilaritySource,
  profile: FitProfile,
  weights: FitWeights,
  openings: readonly JobOpeningView[],
): Promise<(FitResult | null)[]> {
  if (!hasFitCriteria(profile) || openings.length === 0) return openings.map(() => null);

  const stored = await repos.fitScores.findMany({
    where: [{ field: 'openingId', op: 'in', value: openings.map((o) => o.id) }],
  });
  const storedByOpeningId = new Map(stored.map((row) => [row.openingId, row]));
  const semanticReady = search?.embedderReady ?? false;

  const results: (FitResult | null)[] = Array.from({ length: openings.length });
  const stale: { index: number; opening: JobOpeningView; fingerprint: string }[] = [];

  openings.forEach((opening, index) => {
    const fingerprint = fitFingerprint(profile, weights, toScorable(opening));
    const row = storedByOpeningId.get(opening.id);
    const outgrown = row?.semanticUsed === false && semanticReady;
    if (row && row.fingerprint === fingerprint && !outgrown) {
      results[index] = { score: row.score, reasons: row.reasons as FitReason[], semanticUsed: row.semanticUsed };
    } else {
      stale.push({ index, opening, fingerprint });
    }
  });

  if (stale.length > 0) {
    const fresh = await scoreAgainst(
      profile,
      weights,
      search,
      stale.map(({ opening }) => toScorable(opening)),
    );

    await Promise.all(
      stale.map(async ({ index, opening, fingerprint }, i) => {
        const fit = fresh[i]!;
        results[index] = fit;
        const existing = storedByOpeningId.get(opening.id);
        const payload = {
          openingId: opening.id,
          score: fit.score,
          reasons: fit.reasons,
          semanticUsed: fit.semanticUsed,
          fingerprint,
        };
        if (existing) {
          await repos.fitScores.update(existing.id, payload as never);
        } else {
          try {
            await repos.fitScores.create(payload as never);
          } catch {
            // Lost a race with another process caching this same opening's score first — its
            // value is as valid as the one just computed, so there is nothing to reconcile.
          }
        }
      }),
    );
  }

  return results;
}

/** One opening with its fit alongside, for the single-record reads and writes. */
export async function fitOpening(
  repos: Repos,
  search: SimilaritySource,
  opening: JobOpeningView,
): Promise<RankedOpening> {
  const [profile, weights] = await Promise.all([getProfile(repos), getFitWeights(repos)]);
  const [fit] = await scoreOpenings(repos, search, profile, weights, [opening]);
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
  const [openings, profile, weights] = await Promise.all([
    listOpenings(repos, filter),
    getProfile(repos),
    getFitWeights(repos),
  ]);
  const fits = await scoreOpenings(repos, search, profile, weights, openings);

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
