import { describe, expect, it } from 'vitest';
import {
  evaluateDuplicates,
  groupDuplicates,
  shouldBlockSave,
  type DuplicateCandidate,
  type PriorApplication,
} from './duplicates.js';
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

const candidate = (over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id: 'a1',
  companyId: 'c1',
  jobTitle: 'Backend Engineer',
  titleKey: 'backend engineer',
  appliedOn: '2026-01-10',
  status: 'applied',
  createdAt: '2026-01-10T10:00:00.000Z',
  ...over,
});

describe('groupDuplicates', () => {
  it('groups two identical titles at one company', () => {
    const groups = groupDuplicates([candidate({ id: 'a' }), candidate({ id: 'b' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('exact');
    expect(groups[0]!.members.map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('never groups across companies, however alike the titles', () => {
    const groups = groupDuplicates([
      candidate({ id: 'a', companyId: 'c1' }),
      candidate({ id: 'b', companyId: 'c2' }),
    ]);
    expect(groups).toEqual([]);
  });

  it('leaves genuinely different roles alone', () => {
    const groups = groupDuplicates([
      candidate({ id: 'a' }),
      candidate({ id: 'b', jobTitle: 'Graphic Designer', titleKey: 'graphic designer' }),
    ]);
    expect(groups).toEqual([]);
  });

  it('reports a reworded title as one similar group, not two pairs', () => {
    const groups = groupDuplicates([
      candidate({ id: 'a' }),
      candidate({ id: 'b', titleKey: 'backend engineer ii' }),
      candidate({ id: 'c', titleKey: 'backend engineer iii' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('similar');
    expect(groups[0]!.members).toHaveLength(3);
  });

  it('keeps the record that got furthest', () => {
    const groups = groupDuplicates([
      candidate({ id: 'bare', status: 'applied' }),
      candidate({ id: 'live', status: 'interview' }),
    ]);
    expect(groups[0]!.members[0]!.id).toBe('live');
  });

  it('breaks a tie on status with how much each record carries', () => {
    const groups = groupDuplicates(
      [candidate({ id: 'empty' }), candidate({ id: 'full' })],
      { richness: (item) => (item.id === 'full' ? 3 : 0) },
    );
    expect(groups[0]!.members[0]!.id).toBe('full');
  });

  it('falls back to the record that was there first, so the pick is stable', () => {
    // The shape of the real problem: an import run twice leaves two rows identical in
    // everything but their id.
    const groups = groupDuplicates([
      candidate({ id: 'second', createdAt: '2026-01-11T09:00:00.000Z' }),
      candidate({ id: 'first', createdAt: '2026-01-10T09:00:00.000Z' }),
    ]);
    expect(groups[0]!.members.map((m) => m.id)).toEqual(['first', 'second']);
  });

  it('puts exact repeats ahead of merely similar ones', () => {
    const groups = groupDuplicates([
      candidate({ id: 'a', companyId: 'c1' }),
      candidate({ id: 'b', companyId: 'c1', titleKey: 'backend engineer ii' }),
      candidate({ id: 'c', companyId: 'c2' }),
      candidate({ id: 'd', companyId: 'c2' }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['exact', 'similar']);
  });

  it('ignores a record with no title to compare on', () => {
    const groups = groupDuplicates([candidate({ id: 'a', titleKey: '' }), candidate({ id: 'b' })]);
    expect(groups).toEqual([]);
  });
});
