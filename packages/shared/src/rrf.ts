/**
 * Reciprocal Rank Fusion.
 *
 * The lexical and semantic searches produce scores on scales that have nothing to do with
 * each other — BM25 is unbounded and corpus-dependent, cosine sits in [-1, 1]. Normalizing
 * them into a common range means inventing a conversion that is wrong in ways nobody can
 * see. RRF sidesteps that entirely by throwing the scores away and fusing *ranks*:
 *
 *     score(d) = Σ 1 / (k + rank_i(d))
 *
 * A document ranked highly by either retriever surfaces; one ranked highly by both wins.
 * k=60 is the constant from the original paper (Cormack et al., 2009) and damps the
 * influence of the very top ranks so a single retriever cannot dominate the fusion.
 */

export const RRF_K = 60;

export interface RankedList {
  /** Document ids, best first. */
  ids: readonly string[];
  /** Optional multiplier for this retriever's contribution. Defaults to 1. */
  weight?: number;
}

export interface FusedHit {
  id: string;
  score: number;
  /** Zero-based rank in each input list that contained this id, for debugging and UI hints. */
  ranks: Record<string, number>;
}

/**
 * Fuse named ranked lists into one ordering.
 *
 * Ties are broken by id so the ordering is total and stable — two documents with identical
 * fused scores must not swap places between requests, or the UI flickers on refetch.
 */
export function reciprocalRankFusion(
  lists: Record<string, RankedList>,
  k: number = RRF_K,
): FusedHit[] {
  const scores = new Map<string, FusedHit>();

  for (const [name, list] of Object.entries(lists)) {
    const weight = list.weight ?? 1;
    list.ids.forEach((id, index) => {
      const existing = scores.get(id) ?? { id, score: 0, ranks: {} };
      existing.score += weight * (1 / (k + index + 1));
      existing.ranks[name] = index;
      scores.set(id, existing);
    });
  }

  return [...scores.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}
