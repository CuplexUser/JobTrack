/**
 * Similarity measures. Both are used by duplicate detection: Dice on the surface text and
 * cosine on the embeddings, because a title can be reworded ("BE Engineer" vs "Backend
 * Engineer") in ways that defeat character overlap but not meaning, and vice versa.
 */

/**
 * Sørensen–Dice coefficient over character bigrams: 2·|A∩B| / (|A|+|B|).
 *
 * Chosen over Levenshtein because it is order-insensitive at the word level, so "engineer
 * backend" still scores highly against "backend engineer" — a real way people type titles.
 * Multiset intersection, so repeated bigrams count the right number of times.
 */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);

  let intersection = 0;
  for (const [gram, countA] of bigramsA) {
    const countB = bigramsB.get(gram);
    if (countB !== undefined) intersection += Math.min(countA, countB);
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

function bigrams(value: string): Map<string, number> {
  const result = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i += 1) {
    const gram = value.slice(i, i + 2);
    result.set(gram, (result.get(gram) ?? 0) + 1);
  }
  return result;
}

/**
 * Cosine similarity. The embedder L2-normalizes its output, so this reduces to a dot
 * product — but the division is kept so the function is correct for any input, and the
 * cost is one square root per comparison on vectors we would otherwise trust blindly.
 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
