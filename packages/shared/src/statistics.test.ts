import { describe, expect, it } from 'vitest';
import {
  BREAKDOWN_ROWS,
  autoGranularity,
  buckets,
  buildStatistics,
  endOfMonth,
  previousRange,
  startOfIsoWeek,
  type StatisticsApplication,
} from './statistics.js';
import { addDays } from './rules.js';

/** A Tuesday. */
const TODAY = '2026-09-15';

let nextId = 0;
function application(appliedOn: string, over: Partial<StatisticsApplication> = {}): StatisticsApplication {
  nextId += 1;
  return {
    id: `a${nextId}`,
    appliedOn,
    companyId: 'c1',
    companyName: 'Spotify',
    location: 'Stockholm, Sweden',
    workMode: 'hybrid',
    sourceName: 'LinkedIn',
    status: 'applied',
    ...over,
  };
}

describe('calendar helpers', () => {
  it('finds the Monday of a week, across New Year', () => {
    expect(startOfIsoWeek(TODAY)).toBe('2026-09-14');
    expect(startOfIsoWeek('2026-09-14')).toBe('2026-09-14');
    expect(startOfIsoWeek('2026-09-20')).toBe('2026-09-14');
    expect(startOfIsoWeek('2027-01-01')).toBe('2026-12-28');
  });

  it('knows month ends, leap years included', () => {
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-02-01')).toBe('2026-02-28');
    expect(endOfMonth('2026-12-31')).toBe('2026-12-31');
  });

  it('gives the equal stretch just before a range', () => {
    expect(previousRange('2026-09-14', '2026-09-20')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(previousRange(TODAY, TODAY)).toEqual({ from: '2026-09-14', to: '2026-09-14' });
  });

  it('picks bars that suit the length of the range', () => {
    expect(autoGranularity('2026-09-01', '2026-09-30')).toBe('day');
    expect(autoGranularity('2026-06-01', '2026-09-30')).toBe('week');
    expect(autoGranularity('2025-01-01', '2026-09-30')).toBe('month');
  });
});

describe('buckets', () => {
  it('clips partial weeks to the range', () => {
    const weeks = buckets('2026-12-30', '2027-01-12', 'week');
    expect(weeks.map((b) => [b.start, b.end])).toEqual([
      ['2026-12-30', '2027-01-03'],
      ['2027-01-04', '2027-01-10'],
      ['2027-01-11', '2027-01-12'],
    ]);
    expect(weeks[0]!.label).toBe('Week of Dec 28');
  });

  it('rolls months over the year and keeps empty ones', () => {
    const months = buckets('2026-11-15', '2027-02-02', 'month');
    expect(months.map((b) => b.label)).toEqual(['Nov 2026', 'Dec 2026', 'Jan 2027', 'Feb 2027']);
    expect(months[0]!.start).toBe('2026-11-15');
    expect(months.at(-1)!.end).toBe('2027-02-02');
  });
});

describe('buildStatistics', () => {
  it('counts the range, the stretch before it, and the quick windows', () => {
    const stats = buildStatistics({
      applications: [
        application(TODAY),
        application(TODAY),
        application('2026-09-14'),
        application('2026-09-08'), // last week, same weekday as today
        application('2026-09-10'), // last week, after that point
        application('2026-08-20'),
      ],
      openings: [{ savedOn: '2026-09-14', convertedOn: TODAY }],
      from: '2026-09-14',
      to: '2026-09-20',
      today: TODAY,
    });

    expect(stats.range).toEqual({ from: '2026-09-14', to: '2026-09-20', granularity: 'day', days: 7 });
    expect(stats.totals).toMatchObject({
      applications: 3,
      previousApplications: 2,
      openingsSaved: 1,
      openingsConverted: 1,
      activeDays: 2,
      perActiveDay: 1.5,
      busiestDay: { date: TODAY, count: 2 },
      streak: 2,
    });
    expect(stats.series).toHaveLength(7);
    expect(stats.series[1]).toMatchObject({ start: TODAY, applications: 2, openings: 0 });

    const quick = Object.fromEntries(stats.quick.map((w) => [w.key, w]));
    expect(quick.today).toMatchObject({ count: 2, previous: 1 });
    expect(quick.thisWeek).toMatchObject({ from: '2026-09-14', to: '2026-09-20', count: 3, previous: 1 });
    expect(quick.lastWeek).toMatchObject({ from: '2026-09-07', to: '2026-09-13', count: 2 });
    expect(quick.thisMonth).toMatchObject({ from: '2026-09-01', count: 5, previous: 0 });
    expect(quick.last30).toMatchObject({ count: 6 });
  });

  it('runs from the first record to today when no dates are given', () => {
    const stats = buildStatistics({ applications: [application('2025-01-10')], openings: [], today: TODAY });
    expect(stats.range.from).toBe('2025-01-10');
    expect(stats.range.to).toBe(TODAY);
    expect(stats.range.granularity).toBe('month');
    // The calendar is capped to a year of whole weeks, ending with the range.
    expect(stats.calendar.length).toBeLessThanOrEqual(53 * 7);
    expect(stats.calendar.at(-1)!.date).toBe(TODAY);
    expect(stats.calendar[0]!.date).toBe(startOfIsoWeek(stats.calendar[0]!.date));
  });

  it('steps a day granularity up when the range is too long for day bars', () => {
    const stats = buildStatistics({ applications: [], openings: [], from: '2020-01-01', to: TODAY, granularity: 'day', today: TODAY });
    expect(stats.range.granularity).toBe('week');
  });

  it('keeps a streak alive until the end of today', () => {
    const stats = buildStatistics({
      applications: [application('2026-09-14'), application('2026-09-13'), application('2026-09-11')],
      openings: [],
      today: TODAY,
    });
    expect(stats.totals.streak).toBe(2);
  });

  it('groups locations by city, labels them the common way, and folds the tail', () => {
    const applications = [
      application(TODAY, { location: 'Stockholm, Sweden' }),
      application(TODAY, { location: 'stockholm' }),
      application(TODAY, { location: 'Stockholm' }),
      application(TODAY, { location: null }),
      ...Array.from({ length: BREAKDOWN_ROWS + 2 }, (_, i) => application(TODAY, { location: `Town ${i}` })),
    ];
    const stats = buildStatistics({ applications, openings: [], from: TODAY, to: TODAY, today: TODAY });

    expect(stats.byLocation[0]).toMatchObject({ label: 'Stockholm', count: 3, value: 'Stockholm' });
    const other = stats.byLocation.find((row) => row.key === '__other');
    expect(other).toMatchObject({ count: 3, value: null });
    expect(stats.byLocation.at(-1)).toMatchObject({ label: 'Unspecified', count: 1, value: null });
  });

  it('keeps work modes and statuses in their natural order, with filter values', () => {
    const stats = buildStatistics({
      applications: [
        application(TODAY, { workMode: 'unspecified', status: 'interview' }),
        application(TODAY, { workMode: 'remote' }),
        application(TODAY, { workMode: 'remote', status: 'rejected' }),
      ],
      openings: [],
      from: TODAY,
      to: TODAY,
      today: TODAY,
    });
    expect(stats.byWorkMode.map((row) => [row.key, row.count, row.value])).toEqual([
      ['remote', 2, 'remote'],
      ['unspecified', 1, null],
    ]);
    expect(stats.byStatus.map((row) => row.key)).toEqual(['applied', 'interview', 'rejected']);
    expect(stats.totals.responseRate).toBeCloseTo(2 / 3);
    expect(stats.byCompany[0]).toMatchObject({ label: 'Spotify', value: 'c1', share: 1 });
  });

  it('counts nothing outside the range', () => {
    const stats = buildStatistics({
      applications: [application(addDays(TODAY, -1))],
      openings: [],
      from: TODAY,
      to: TODAY,
      today: TODAY,
    });
    expect(stats.totals.applications).toBe(0);
    expect(stats.totals.previousApplications).toBe(1);
    expect(stats.byLocation).toEqual([]);
  });
});
