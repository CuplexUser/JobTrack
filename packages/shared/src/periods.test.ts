import { describe, expect, it } from 'vitest';
import { formatDateOnly, isOnOrBefore, monthName, parseDateOnly, periodKey, toPeriod } from './periods.js';

describe('parseDateOnly', () => {
  it('pins the date to UTC midnight', () => {
    const date = parseDateOnly('2026-03-12');
    expect(date.toISOString()).toBe('2026-03-12T00:00:00.000Z');
  });

  it('rejects dates that are not real', () => {
    // Date.UTC would silently roll 30 February forward into March.
    expect(() => parseDateOnly('2026-02-30')).toThrow(/not a real calendar date/i);
    expect(() => parseDateOnly('2026-13-01')).toThrow();
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(() => parseDateOnly('12/03/2026')).toThrow();
    expect(() => parseDateOnly('2026-3-12')).toThrow();
  });
});

describe('toPeriod', () => {
  it('derives year and month from a date string', () => {
    expect(toPeriod('2026-03-12')).toEqual({ year: 2026, month: 3 });
  });

  it('keeps the first of the month on the first of the month', () => {
    // The bug this guards: reading UTC-midnight dates with local getters puts anyone west
    // of Greenwich in the previous month, so the period columns would disagree with the
    // date shown on the record.
    expect(toPeriod('2026-01-01')).toEqual({ year: 2026, month: 1 });
    expect(toPeriod('2025-12-31')).toEqual({ year: 2025, month: 12 });
  });

  it('round-trips through formatDateOnly', () => {
    for (const value of ['2024-02-29', '2026-01-01', '2025-12-31']) {
      expect(formatDateOnly(parseDateOnly(value))).toBe(value);
    }
  });
});

describe('periodKey and monthName', () => {
  it('zero-pads so keys sort chronologically as strings', () => {
    expect(periodKey({ year: 2026, month: 3 })).toBe('2026-03');
    expect(['2026-10', '2026-03', '2026-01'].sort()).toEqual(['2026-01', '2026-03', '2026-10']);
  });

  it('names months', () => {
    expect(monthName(1)).toBe('January');
    expect(monthName(12)).toBe('December');
  });
});

describe('isOnOrBefore', () => {
  it('compares date-only strings lexically', () => {
    expect(isOnOrBefore('2026-01-01', '2026-01-02')).toBe(true);
    expect(isOnOrBefore('2026-02-01', '2026-01-31')).toBe(false);
  });
});
