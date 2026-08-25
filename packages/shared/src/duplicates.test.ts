import { describe, expect, it } from 'vitest';
import { evaluateDuplicates, shouldBlockSave, type PriorApplication } from './duplicates.js';
import { diceCoefficient, cosineSimilarity } from './similarity.js';

const prior = (over: Partial<PriorApplication> = {}): PriorApplication => ({
  id: 'p1',
  jobTitle: 'Backend Engineer',
  titleKey: 'backend engineer',
  appliedOn: '2025-01-14',
  status: 'rejected',
  ...over,
});

describe('evaluateDuplicates', () => {
  it('reports nothing for a company with no history', () => {
    const check = evaluateDuplicates('Backend Engineer', []);
    expect(check.verdict).toBe('none');
    expect(check.companyMatched).toBe(false);
    expect(check.matches).toEqual([]);
  });

  it('flags an identical title as exact', () => {
    const check = evaluateDuplicates('backend  ENGINEER', [prior()]);
    expect(check.verdict).toBe('exact');
    expect(check.matches[0]!.matchKind).toBe('exact');
    expect(check.matches[0]!.titleSimilarity).toBe(1);
  });

  it('flags a reworded title as similar', () => {
    const check = evaluateDuplicates('Senior Backend Engineer', [prior()]);
    expect(check.verdict).toBe('similar');
    expect(check.matches[0]!.matchKind).toBe('similar');
  });

  it('reports company-only when the roles are genuinely different', () => {
    const check = evaluateDuplicates('Graphic Designer', [prior()]);
    expect(check.verdict).toBe('company');
    expect(check.companyMatched).toBe(true);
    expect(check.matches).toEqual([]);
    expect(check.priorCount).toBe(1);
  });

  it('does not confuse frontend with backend despite the shared text', () => {
    // These share most of their characters, which is exactly why the threshold matters.
    const check = evaluateDuplicates('Frontend Engineer', [prior()]);
    expect(check.verdict).toBe('company');
  });

  it('uses semantic similarity to catch a rewording that text similarity misses', () => {
    const withoutSemantics = evaluateDuplicates('Server-Side Developer', [prior()]);
    expect(withoutSemantics.verdict).toBe('company');

    const withSemantics = evaluateDuplicates('Server-Side Developer', [
      prior({ semanticSimilarity: 0.88 }),
    ]);
    expect(withSemantics.verdict).toBe('similar');
    expect(withSemantics.matches[0]!.semanticSimilarity).toBe(0.88);
  });

  it('ignores weak semantic scores', () => {
    const check = evaluateDuplicates('Graphic Designer', [prior({ semanticSimilarity: 0.3 })]);
    expect(check.verdict).toBe('company');
  });

  it('puts exact matches first, then the strongest', () => {
    const check = evaluateDuplicates('Backend Engineer', [
      prior({ id: 'similar', jobTitle: 'Senior Backend Engineer', titleKey: 'senior backend engineer' }),
      prior({ id: 'exact' }),
    ]);
    expect(check.matches.map((m) => m.id)).toEqual(['exact', 'similar']);
  });

  it('breaks ties among equals by recency', () => {
    const check = evaluateDuplicates('Backend Engineer', [
      prior({ id: 'older', appliedOn: '2024-01-01' }),
      prior({ id: 'newer', appliedOn: '2026-01-01' }),
    ]);
    expect(check.matches.map((m) => m.id)).toEqual(['newer', 'older']);
  });

  it('counts every prior application, not just the matching ones', () => {
    const check = evaluateDuplicates('Backend Engineer', [
      prior({ id: 'a' }),
      prior({ id: 'b', jobTitle: 'Graphic Designer', titleKey: 'graphic designer' }),
    ]);
    expect(check.priorCount).toBe(2);
    expect(check.matches).toHaveLength(1);
  });

  it('reports company-only when the title is blank', () => {
    // The dashboard widget allows a company with no title — it should still say you have
    // been here before.
    const check = evaluateDuplicates('', [prior()]);
    expect(check.verdict).toBe('company');
    expect(check.matches).toEqual([]);
  });
});

describe('shouldBlockSave', () => {
  it('only interrupts on an exact duplicate', () => {
    expect(shouldBlockSave('exact')).toBe(true);
    expect(shouldBlockSave('similar')).toBe(false);
    expect(shouldBlockSave('company')).toBe(false);
    expect(shouldBlockSave('none')).toBe(false);
  });
});

describe('diceCoefficient', () => {
  it('is 1 for identical strings and 0 for nothing in common', () => {
    expect(diceCoefficient('backend engineer', 'backend engineer')).toBe(1);
    expect(diceCoefficient('abc', 'xyz')).toBe(0);
  });

  it('is order-insensitive at the word level', () => {
    // "engineer backend" is a real way people type a title.
    expect(diceCoefficient('backend engineer', 'engineer backend')).toBeGreaterThan(0.8);
  });

  it('handles strings too short to have bigrams', () => {
    expect(diceCoefficient('a', 'a')).toBe(1);
    expect(diceCoefficient('a', 'b')).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for parallel vectors and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 rather than NaN for a zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('refuses mismatched lengths instead of comparing nonsense', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/length mismatch/);
  });
});
