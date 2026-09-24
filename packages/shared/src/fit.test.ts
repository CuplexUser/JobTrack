import { describe, expect, it } from 'vitest';
import { DEFAULT_FIT_WEIGHTS, hasFitCriteria, scoreFit, titleMatch, type FitPosting, type FitProfile } from './fit.js';

const empty: FitProfile = {
  summary: null,
  targetTitles: [],
  locationTiers: [],
  workModes: [],
  salaryFloor: null,
  salaryCurrency: null,
  includeKeywords: [],
  excludeKeywords: [],
};

const profile = (over: Partial<FitProfile>): FitProfile => ({ ...empty, ...over });

/** One priority level at full share, which is how a flat list of places scored before levels. */
const anywhereIn = (...places: string[]): FitProfile['locationTiers'] => [{ places, share: 100 }];

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
      profile({ targetTitles: ['Backend Engineer'], locationTiers: anywhereIn('Stockholm'), workModes: ['hybrid', 'remote'] }),
      posting(),
    );
    expect(result!.score).toBe(100);
    expect(labels(result)).toEqual(['plus:title', 'plus:location', 'plus:workMode']);
  });

  it('only counts what the profile specifies, so one criterion still spans the whole range', () => {
    expect(scoreFit(profile({ locationTiers: anywhereIn('Stockholm') }), posting())!.score).toBe(100);
    expect(scoreFit(profile({ locationTiers: anywhereIn('Göteborg') }), posting())!.score).toBe(0);
  });

  it('treats a remote role as in every place when the user works remotely', () => {
    const result = scoreFit(
      profile({ locationTiers: anywhereIn('Umeå'), workModes: ['remote'] }),
      posting({ location: 'Berlin', workMode: 'remote' }),
    );
    expect(result!.score).toBe(100);
  });

  describe('location priority levels', () => {
    const tiers: FitProfile['locationTiers'] = [
      { places: ['Stockholm'], share: 100 },
      { places: ['Uppsala', 'Västerås'], share: 60 },
      { places: ['Göteborg'], share: 0 },
    ];

    it('scales only the location weight by the share of the level the posting is in', () => {
      const weights = { ...DEFAULT_FIT_WEIGHTS, title: 30, location: 20 };
      const withTitle = profile({ targetTitles: ['Backend Engineer'], locationTiers: tiers });
      // title 30 of 30, location 12 of 20: 42 of 50.
      expect(scoreFit(withTitle, posting({ location: 'Uppsala' }), null, weights)!.score).toBe(84);
      expect(scoreFit(withTitle, posting({ location: 'Stockholm' }), null, weights)!.score).toBe(100);
    });

    it('treats every place in one level the same', () => {
      const only = profile({ locationTiers: tiers });
      expect(scoreFit(only, posting({ location: 'Uppsala' }))!.score).toBe(60);
      expect(scoreFit(only, posting({ location: 'Västerås, Sweden' }))!.score).toBe(60);
    });

    it('explains a lower level with its priority and share', () => {
      const result = scoreFit(profile({ locationTiers: tiers }), posting({ location: 'Uppsala' }));
      expect(result!.reasons[0]).toMatchObject({
        effect: 'plus',
        i18nKey: 'location.matchedTier',
        i18nParams: { place: 'Uppsala', tier: 2, share: 60 },
      });
    });

    it('earns nothing, without counting against, in a level worth 0%', () => {
      const result = scoreFit(profile({ locationTiers: tiers }), posting({ location: 'Göteborg' }));
      expect(result!.score).toBe(0);
      expect(labels(result)).toEqual(['neutral:location']);
    });

    it('uses the best level a posting matches', () => {
      const overlapping = profile({
        locationTiers: [
          { places: ['Stockholm'], share: 80 },
          { places: ['Sweden'], share: 20 },
        ],
      });
      expect(scoreFit(overlapping, posting({ location: 'Stockholm, Sweden' }))!.score).toBe(80);
      expect(scoreFit(overlapping, posting({ location: 'Luleå, Sweden' }))!.score).toBe(20);
    });

    it('never scores a remote role below full marks for naming a lower-priority city', () => {
      const result = scoreFit(profile({ locationTiers: tiers, workModes: ['remote'] }), posting({ location: 'Göteborg', workMode: 'remote' }));
      expect(result!.score).toBe(100);
    });
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
