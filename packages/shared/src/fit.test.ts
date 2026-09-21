import { describe, expect, it } from 'vitest';
import { DEFAULT_FIT_WEIGHTS, hasFitCriteria, scoreFit, titleMatch, type FitPosting, type FitProfile } from './fit.js';

const empty: FitProfile = {
  summary: null,
  targetTitles: [],
  locations: [],
  workModes: [],
  salaryFloor: null,
  salaryCurrency: null,
  includeKeywords: [],
  excludeKeywords: [],
};

const profile = (over: Partial<FitProfile>): FitProfile => ({ ...empty, ...over });

const posting = (over: Partial<FitPosting> = {}): FitPosting => ({
  jobTitle: 'Senior Backend Engineer',
  location: 'Stockholm, Sweden',
  workMode: 'hybrid',
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  notes: null,
  ...over,
});

const labels = (result: ReturnType<typeof scoreFit>) => result!.reasons.map((reason) => `${reason.effect}:${reason.factor}`);

describe('scoreFit', () => {
  it('has nothing to say without a profile', () => {
    expect(hasFitCriteria(empty)).toBe(false);
    expect(scoreFit(empty, posting())).toBeNull();
  });

  it('gives full marks when everything the profile asks for is there', () => {
    const result = scoreFit(
      profile({ targetTitles: ['Backend Engineer'], locations: ['Stockholm'], workModes: ['hybrid', 'remote'] }),
      posting(),
    );
    expect(result!.score).toBe(100);
    expect(labels(result)).toEqual(['plus:title', 'plus:location', 'plus:workMode']);
  });

  it('only counts what the profile specifies, so one criterion still spans the whole range', () => {
    expect(scoreFit(profile({ locations: ['Stockholm'] }), posting())!.score).toBe(100);
    expect(scoreFit(profile({ locations: ['Göteborg'] }), posting())!.score).toBe(0);
  });

  it('treats a remote role as in every place when the user works remotely', () => {
    const result = scoreFit(
      profile({ locations: ['Umeå'], workModes: ['remote'] }),
      posting({ location: 'Berlin', workMode: 'remote' }),
    );
    expect(result!.score).toBe(100);
  });

  it('gives half credit when the posting does not say', () => {
    const result = scoreFit(
      profile({ workModes: ['remote'], salaryFloor: 700000 }),
      posting({ workMode: 'unspecified' }),
    );
    expect(result!.score).toBe(50);
    expect(result!.reasons.every((reason) => reason.effect === 'neutral')).toBe(true);
  });

  it('marks down a salary that tops out below the floor, but not one in another currency', () => {
    const floor = profile({ salaryFloor: 700000, salaryCurrency: 'SEK' });
    expect(scoreFit(floor, posting({ salaryMin: 500000, salaryMax: 650000, salaryCurrency: 'SEK' }))!.score).toBe(0);
    expect(scoreFit(floor, posting({ salaryMin: 600000, salaryMax: 800000, salaryCurrency: 'sek' }))!.score).toBe(100);
    expect(scoreFit(floor, posting({ salaryMax: 90000, salaryCurrency: 'EUR' }))!.score).toBe(50);
  });

  it('takes a large share off for each excluded keyword, matched as a whole word', () => {
    const avoid = profile({ targetTitles: ['Backend Engineer'], excludeKeywords: ['PHP'] });
    const clean = scoreFit(avoid, posting({ notes: 'We use Kotlin.' }))!;
    const flagged = scoreFit(avoid, posting({ notes: 'Legacy PHP monolith.' }))!;
    expect(clean.score).toBe(100);
    expect(flagged.score).toBe(100 - DEFAULT_FIT_WEIGHTS.excludedPenalty);
    expect(flagged.reasons[0]).toMatchObject({ factor: 'excluded', effect: 'minus' });
    // Whole words only: "phpstorm" is not "php".
    expect(scoreFit(avoid, posting({ notes: 'Licenses for PhpStorm.' }))!.score).toBe(100);
  });

  it('rewards wanted keywords, capped so three hits are enough for full credit', () => {
    const wants = profile({ includeKeywords: ['Kotlin', 'Postgres', 'Kafka', 'Go'] });
    expect(scoreFit(wants, posting({ notes: 'Kotlin and Postgres and Kafka' }))!.score).toBe(100);
    expect(scoreFit(wants, posting({ notes: 'Kotlin only' }))!.score).toBe(33);
    // "Go" must not match "Google".
    expect(scoreFit(wants, posting({ notes: 'Formerly at Google' }))!.score).toBe(0);
  });

  it('adds the summary comparison only when a similarity is supplied', () => {
    const withSummary = profile({ summary: 'Backend engineer in payments', targetTitles: ['Backend Engineer'] });
    const rulesOnly = scoreFit(withSummary, posting());
    expect(rulesOnly).toMatchObject({ score: 100, semanticUsed: false });

    const far = scoreFit(withSummary, posting(), 0.1)!;
    const close = scoreFit(withSummary, posting(), 0.6)!;
    expect(far.semanticUsed).toBe(true);
    expect(far.score).toBeLessThan(close.score);
    expect(close.score).toBe(100);
  });
});

describe('titleMatch', () => {
  it('gives full marks when every word of the target is in the title', () => {
    expect(titleMatch('Senior Backend Engineer, Payments', 'Backend Engineer')).toBe(1);
  });

  it('scores unrelated titles low', () => {
    expect(titleMatch('Graphic Designer', 'Backend Engineer')).toBeLessThan(0.5);
  });
});
