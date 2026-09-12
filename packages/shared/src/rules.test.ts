import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, defaultFollowUpDate } from './rules.js';
import { profilePatchSchema } from './schemas.js';

describe('date arithmetic', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-12-28', '2027-01-04')).toBe(7);
  });
});

describe('defaultFollowUpDate', () => {
  const today = '2026-09-12';

  it('is off when the rule is off', () => {
    expect(defaultFollowUpDate(null, today, 'applied', today)).toBeNull();
  });

  it('dates a new live application the configured number of days after applying', () => {
    expect(defaultFollowUpDate(7, '2026-09-10', 'applied', today)).toBe('2026-09-17');
    expect(defaultFollowUpDate(7, '2026-09-10', 'interview', today)).toBe('2026-09-17');
  });

  it('never gives a date already past, so imported history stays quiet', () => {
    expect(defaultFollowUpDate(7, '2025-01-10', 'applied', today)).toBeNull();
  });

  it('gives none to an application that is already over', () => {
    expect(defaultFollowUpDate(7, today, 'rejected', today)).toBeNull();
  });
});

describe('profilePatchSchema', () => {
  it('carries only the fields sent, so a partial save cannot wipe the rest of the profile', () => {
    expect(profilePatchSchema.parse({ targetTitles: ['Backend Engineer'] })).toEqual({ targetTitles: ['Backend Engineer'] });
  });
});
