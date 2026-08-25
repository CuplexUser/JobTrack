import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from './rrf.js';

describe('reciprocalRankFusion', () => {
  it('ranks a document found by both retrievers above one found by either alone', () => {
    const fused = reciprocalRankFusion({
      lexical: { ids: ['a', 'b', 'c'] },
      semantic: { ids: ['c', 'd', 'e'] },
    });
    // 'c' appears in both lists, so it should beat 'a' which only tops one.
    expect(fused[0]!.id).toBe('c');
  });

  it('still surfaces documents only one retriever found', () => {
    const fused = reciprocalRankFusion({
      lexical: { ids: ['a'] },
      semantic: { ids: ['z'] },
    });
    expect(fused.map((h) => h.id).sort()).toEqual(['a', 'z']);
  });

  it('records the rank each retriever gave, for the match explanation', () => {
    const fused = reciprocalRankFusion({
      lexical: { ids: ['a', 'b'] },
      semantic: { ids: ['b'] },
    });
    const b = fused.find((h) => h.id === 'b')!;
    expect(b.ranks).toEqual({ lexical: 1, semantic: 0 });
  });

  it('honours a retriever weight', () => {
    const weighted = reciprocalRankFusion({
      lexical: { ids: ['a'], weight: 0.1 },
      semantic: { ids: ['b'], weight: 10 },
    });
    expect(weighted[0]!.id).toBe('b');
  });

  it('is total and stable, so the UI does not flicker on refetch', () => {
    // 'x' and 'y' tie exactly; the id breaks the tie deterministically.
    const once = reciprocalRankFusion({ a: { ids: ['y'] }, b: { ids: ['x'] } });
    const twice = reciprocalRankFusion({ a: { ids: ['y'] }, b: { ids: ['x'] } });
    expect(once.map((h) => h.id)).toEqual(twice.map((h) => h.id));
    expect(once.map((h) => h.id)).toEqual(['x', 'y']);
  });

  it('returns nothing for empty input', () => {
    expect(reciprocalRankFusion({})).toEqual([]);
  });
});
