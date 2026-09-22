/**
 * How well a posting fits what the user is looking for.
 *
 * Deliberately a transparent sum of named parts rather than a single opaque number: every
 * point a posting earns or loses comes with a reason the UI can show ("hybrid, as you want",
 * "salary tops out below your floor"), so a surprising rank can be understood and the
 * profile corrected. A score nobody can explain is a score nobody trusts.
 *
 * Only what the profile actually specifies counts. A profile with no preferred locations
 * neither rewards nor penalizes any location, and the score is a share of the points the
 * profile made available, so a sparse profile still produces a spread from 0 to 100.
 *
 * Pure and browser-safe. The semantic part (how close the posting reads to the user's own
 * summary) needs embeddings, so the API computes it and passes it in; without it the other
 * parts still rank, which is what happens while the model is loading.
 */

import { locationKey, titleKey } from './normalize.js';
import { diceCoefficient } from './similarity.js';
import type { FitWeights } from './schemas.js';
import type { JobOpeningView, WorkMode } from './types.js';

export interface FitProfile {
  summary: string | null;
  targetTitles: readonly string[];
  locations: readonly string[];
  workModes: readonly WorkMode[];
  salaryFloor: number | null;
  salaryCurrency: string | null;
  includeKeywords: readonly string[];
  excludeKeywords: readonly string[];
}

export interface FitPosting {
  jobTitle: string;
  location: string | null;
  workMode: WorkMode;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  notes: string | null;
}

export type FitFactor = 'title' | 'location' | 'workMode' | 'salary' | 'keywords' | 'excluded' | 'summary';

export interface FitReason {
  factor: FitFactor;
  /** Whether this part helped or hurt. `neutral` when the posting did not say. */
  effect: 'plus' | 'minus' | 'neutral';
  /** Pre-formatted English text — used as-is by apps/mcp, apps/api and apps/tray. */
  label: string;
  /** Translation key `apps/web` looks up instead of `label`, to localize this reason. */
  i18nKey: string;
  i18nParams?: Record<string, string | number>;
}

export interface FitResult {
  /** 0 to 100. */
  score: number;
  reasons: FitReason[];
  /** False when the summary comparison was unavailable, so the score rests on the rules alone. */
  semanticUsed: boolean;
}

/**
 * The weights `scoreFit` falls back to when none are given — same values `fitWeightsSchema`
 * (schemas.ts) defaults to, so an unset profile setting and an explicit call from a test or
 * `scorePostings` mean the same thing. MiniLM puts unrelated text pairs around 0.1 to 0.2
 * cosine similarity and a posting that matches a CV's field around 0.5 to 0.6, which is what
 * `semanticFloor`/`semanticCeiling` are stretched across.
 */
export const DEFAULT_FIT_WEIGHTS: FitWeights = {
  title: 30,
  summary: 25,
  location: 15,
  workMode: 10,
  salary: 10,
  keywords: 10,
  excludedPenalty: 40,
  semanticFloor: 0.2,
  semanticCeiling: 0.55,
};

const WORK_MODE_WORDS: Record<WorkMode, string> = {
  remote: 'remote',
  hybrid: 'hybrid',
  onsite: 'on-site',
  unspecified: 'unspecified',
};

/** True when the profile gives the scorer anything to go on. */
export function hasFitCriteria(profile: FitProfile): boolean {
  return (
    Boolean(profile.summary?.trim()) ||
    profile.targetTitles.length > 0 ||
    profile.locations.length > 0 ||
    profile.workModes.length > 0 ||
    profile.salaryFloor !== null ||
    profile.includeKeywords.length > 0 ||
    profile.excludeKeywords.length > 0
  );
}

/**
 * How closely a title matches one the user is after: Dice similarity, or full marks when
 * every word of the target appears in the title, so "Senior Backend Engineer, Payments"
 * matches a target of "Backend Engineer" as well as it should.
 */
export function titleMatch(title: string, target: string): number {
  const titleWords = titleKey(title);
  const targetWords = titleKey(target);
  if (!titleWords || !targetWords) return 0;
  const words = new Set(titleWords.split(' '));
  if (targetWords.split(' ').every((word) => words.has(word))) return 1;
  return diceCoefficient(titleWords, targetWords);
}

/** Whole-word, case- and accent-insensitive: "Go" should not match "Google". */
function containsKeyword(text: string, keyword: string): boolean {
  const needle = titleKey(keyword);
  if (!needle) return false;
  return ` ${titleKey(text)} `.includes(` ${needle} `);
}

export function scoreFit(
  profile: FitProfile,
  posting: FitPosting,
  semanticSimilarity: number | null = null,
  weights: FitWeights = DEFAULT_FIT_WEIGHTS,
): FitResult | null {
  if (!hasFitCriteria(profile)) return null;

  const reasons: FitReason[] = [];
  let earned = 0;
  let possible = 0;
  const text = [posting.jobTitle, posting.notes].filter(Boolean).join(' ');

  if (profile.targetTitles.length > 0) {
    possible += weights.title;
    const best = Math.max(...profile.targetTitles.map((target) => titleMatch(posting.jobTitle, target)));
    const bestTarget = profile.targetTitles.find((target) => titleMatch(posting.jobTitle, target) === best)!;
    if (best >= 0.75) {
      earned += weights.title * best;
      reasons.push({
        factor: 'title',
        effect: 'plus',
        label: `Title matches "${bestTarget}"`,
        i18nKey: 'title.matches',
        i18nParams: { target: bestTarget },
      });
    } else if (best >= 0.5) {
      earned += weights.title * best * 0.6;
      reasons.push({
        factor: 'title',
        effect: 'plus',
        label: `Title is close to "${bestTarget}"`,
        i18nKey: 'title.close',
        i18nParams: { target: bestTarget },
      });
    } else {
      reasons.push({
        factor: 'title',
        effect: 'minus',
        label: 'Title is not one you are looking for',
        i18nKey: 'title.mismatch',
      });
    }
  }

  if (profile.summary?.trim()) {
    if (semanticSimilarity !== null) {
      possible += weights.summary;
      const share = Math.min(
        1,
        Math.max(0, (semanticSimilarity - weights.semanticFloor) / (weights.semanticCeiling - weights.semanticFloor)),
      );
      earned += weights.summary * share;
      if (share >= 0.6) {
        reasons.push({ factor: 'summary', effect: 'plus', label: 'Reads close to your profile', i18nKey: 'summary.close' });
      } else if (share <= 0.2) {
        reasons.push({ factor: 'summary', effect: 'minus', label: 'Reads far from your profile', i18nKey: 'summary.far' });
      }
    }
  }

  if (profile.locations.length > 0) {
    possible += weights.location;
    const where = posting.location ? locationKey(posting.location) : '';
    const matched = profile.locations.find((place) => where.includes(locationKey(place)));
    if (matched) {
      earned += weights.location;
      reasons.push({ factor: 'location', effect: 'plus', label: `In ${matched}`, i18nKey: 'location.matched', i18nParams: { place: matched } });
    } else if (posting.workMode === 'remote' && profile.workModes.includes('remote')) {
      // A remote role is in every location the user is willing to work remotely from.
      earned += weights.location;
      reasons.push({ factor: 'location', effect: 'plus', label: 'Remote, so location does not matter', i18nKey: 'location.remote' });
    } else if (!posting.location) {
      earned += weights.location / 2;
      reasons.push({ factor: 'location', effect: 'neutral', label: 'Location not stated', i18nKey: 'location.notStated' });
    } else {
      reasons.push({
        factor: 'location',
        effect: 'minus',
        label: `In ${posting.location}, not a place you listed`,
        i18nKey: 'location.mismatch',
        i18nParams: { location: posting.location },
      });
    }
  }

  if (profile.workModes.length > 0) {
    possible += weights.workMode;
    if (posting.workMode === 'unspecified') {
      earned += weights.workMode / 2;
      reasons.push({ factor: 'workMode', effect: 'neutral', label: 'Work mode not stated', i18nKey: 'workMode.notStated' });
    } else if (profile.workModes.includes(posting.workMode)) {
      earned += weights.workMode;
      const mode = capitalize(WORK_MODE_WORDS[posting.workMode]);
      reasons.push({ factor: 'workMode', effect: 'plus', label: `${mode}, as you want`, i18nKey: 'workMode.matched', i18nParams: { mode } });
    } else {
      const mode = capitalize(WORK_MODE_WORDS[posting.workMode]);
      reasons.push({ factor: 'workMode', effect: 'minus', label: `${mode}, which you did not pick`, i18nKey: 'workMode.mismatch', i18nParams: { mode } });
    }
  }

  if (profile.salaryFloor !== null) {
    possible += weights.salary;
    const comparable =
      !profile.salaryCurrency ||
      !posting.salaryCurrency ||
      profile.salaryCurrency.toUpperCase() === posting.salaryCurrency.toUpperCase();
    const top = posting.salaryMax ?? posting.salaryMin;
    if (top === null || !comparable) {
      earned += weights.salary / 2;
      reasons.push(
        top === null
          ? { factor: 'salary', effect: 'neutral', label: 'Salary not stated', i18nKey: 'salary.notStated' }
          : {
              factor: 'salary',
              effect: 'neutral',
              label: `Salary is in ${posting.salaryCurrency}, not ${profile.salaryCurrency}`,
              i18nKey: 'salary.currencyMismatch',
              i18nParams: { postingCurrency: posting.salaryCurrency!, profileCurrency: profile.salaryCurrency! },
            },
      );
    } else if (top < profile.salaryFloor) {
      reasons.push({ factor: 'salary', effect: 'minus', label: 'Salary tops out below your floor', i18nKey: 'salary.belowFloor' });
    } else {
      earned += weights.salary;
      reasons.push({ factor: 'salary', effect: 'plus', label: 'Salary reaches your floor', i18nKey: 'salary.reachesFloor' });
    }
  }

  if (profile.includeKeywords.length > 0) {
    possible += weights.keywords;
    const hits = profile.includeKeywords.filter((keyword) => containsKeyword(text, keyword));
    earned += weights.keywords * Math.min(1, hits.length / Math.min(3, profile.includeKeywords.length));
    if (hits.length > 0) {
      reasons.push({
        factor: 'keywords',
        effect: 'plus',
        label: `Mentions ${hits.join(', ')}`,
        i18nKey: 'keywords.mentions',
        i18nParams: { keywords: hits.join(', ') },
      });
    }
  }

  let score = possible > 0 ? (earned / possible) * 100 : 50;

  const excluded = profile.excludeKeywords.filter((keyword) => containsKeyword(text, keyword));
  if (excluded.length > 0) {
    score -= weights.excludedPenalty * excluded.length;
    reasons.unshift({
      factor: 'excluded',
      effect: 'minus',
      label: `Mentions ${excluded.join(', ')}, which you want to avoid`,
      i18nKey: 'excluded.mentions',
      i18nParams: { keywords: excluded.join(', ') },
    });
  }

  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    reasons,
    semanticUsed: semanticSimilarity !== null,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** An opening with its fit against the profile, or null when there is no profile to score against. */
export interface RankedOpening extends JobOpeningView {
  fit: FitResult | null;
}
