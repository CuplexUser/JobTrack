/**
 * The statistics page's arithmetic: how many applications went out over a stretch of days,
 * how that compares with the stretch before, and where they went.
 *
 * Pure, like `duplicates.ts`, so every boundary (a week that crosses New Year, a month with
 * no applications) is unit-tested here and the API service only fetches. Every date is a
 * `YYYY-MM-DD` calendar day handled in UTC, for the reasons `periods.ts` gives.
 */

import { MONTH_NAMES, formatDateOnly, parseDateOnly } from './periods.js';
import { normalizeText } from './normalize.js';
import { addDays, daysBetween } from './rules.js';
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
  type ApplicationStatus,
  type WorkMode,
} from './types.js';

export const STATISTICS_GRANULARITIES = ['day', 'week', 'month'] as const;
export type StatisticsGranularity = (typeof STATISTICS_GRANULARITIES)[number];

/** Past this many bars a chart is a smear, so a finer granularity steps up to a coarser one. */
export const MAX_BUCKETS = 400;

/** How far back the activity calendar reaches: a year of weeks, like a contribution graph. */
export const CALENDAR_WEEKS = 53;

/** How many named rows a breakdown keeps before folding the rest into "Other". */
export const BREAKDOWN_ROWS = 12;

// ---------------------------------------------------------------- calendar helpers

/** The Monday of the ISO week `date` falls in. */
export function startOfIsoWeek(date: string): string {
  const weekday = (parseDateOnly(date).getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  return addDays(date, -weekday);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const d = parseDateOnly(startOfMonth(date));
  return formatDateOnly(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** The stretch of the same length that ends the day before `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = daysBetween(from, to) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

/** Day bars for up to a month, week bars for up to half a year, month bars beyond. */
export function autoGranularity(from: string, to: string): StatisticsGranularity {
  const days = daysBetween(from, to) + 1;
  if (days <= 31) return 'day';
  if (days <= 182) return 'week';
  return 'month';
}

function shortMonth(month: number): string {
  return MONTH_NAMES[month - 1]!.slice(0, 3);
}

/** "Sep 14", the way a day is named on an axis. */
function dayLabel(date: string): string {
  return `${shortMonth(Number(date.slice(5, 7)))} ${Number(date.slice(8, 10))}`;
}

export interface StatisticsBucket {
  /** First day counted, clipped to the range. */
  start: string;
  /** Last day counted, clipped to the range. */
  end: string;
  label: string;
}

/**
 * The bars for a range, empty ones included: a week with nothing sent is as much a part of
 * the picture as a busy one. Partial weeks and months at either end are clipped to the
 * range, so a bar's dates are exactly the days it counted.
 */
export function buckets(from: string, to: string, granularity: StatisticsGranularity): StatisticsBucket[] {
  const result: StatisticsBucket[] = [];
  let cursor = from;
  while (cursor <= to) {
    let naturalEnd: string;
    let label: string;
    if (granularity === 'day') {
      naturalEnd = cursor;
      label = dayLabel(cursor);
    } else if (granularity === 'week') {
      const monday = startOfIsoWeek(cursor);
      naturalEnd = addDays(monday, 6);
      label = `Week of ${dayLabel(monday)}`;
    } else {
      naturalEnd = endOfMonth(cursor);
      label = `${shortMonth(Number(cursor.slice(5, 7)))} ${cursor.slice(0, 4)}`;
    }
    const end = naturalEnd < to ? naturalEnd : to;
    result.push({ start: cursor, end, label });
    cursor = addDays(end, 1);
  }
  return result;
}

/** The granularity asked for, stepped up until the range fits in `MAX_BUCKETS` bars. */
function fittingGranularity(from: string, to: string, wanted: StatisticsGranularity): StatisticsGranularity {
  const days = daysBetween(from, to) + 1;
  if (wanted === 'day' && days > MAX_BUCKETS) wanted = 'week';
  if (wanted === 'week' && days / 7 > MAX_BUCKETS) wanted = 'month';
  return wanted;
}

// ---------------------------------------------------------------- input and output

export interface StatisticsApplication {
  id: string;
  appliedOn: string;
  companyId: string;
  companyName: string;
  location: string | null;
  workMode: WorkMode;
  sourceName: string | null;
  status: ApplicationStatus;
}

export interface StatisticsOpening {
  savedOn: string;
  /** The day the application it became was sent, when it became one. */
  convertedOn: string | null;
}

export interface StatisticsInput {
  applications: readonly StatisticsApplication[];
  openings: readonly StatisticsOpening[];
  /** Omitted means from the first record on file. */
  from?: string;
  /** Omitted means today. */
  to?: string;
  /** Omitted means `autoGranularity`. */
  granularity?: StatisticsGranularity;
  today: string;
}

export const QUICK_WINDOWS = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'last30'] as const;
export type QuickWindowKey = (typeof QUICK_WINDOWS)[number];

export interface QuickWindow {
  key: QuickWindowKey;
  label: string;
  from: string;
  to: string;
  count: number;
  /** The same stretch one step earlier, to read the count against. */
  previous: number;
  /** What `previous` covers, in words. */
  previousLabel: string;
}

export interface StatisticsTotals {
  applications: number;
  previousApplications: number;
  previousFrom: string;
  previousTo: string;
  openingsSaved: number;
  /** Openings in JobTrack that turned into an application sent inside the range. */
  openingsConverted: number;
  /** Days in the range with at least one application. */
  activeDays: number;
  /** Applications per day that had any, 0 when none did. */
  perActiveDay: number;
  busiestDay: { date: string; count: number } | null;
  /** Consecutive days with an application, ending today, or yesterday when today has none yet. */
  streak: number;
  /** Applications in the range that got any reply: any status past "applied". */
  responded: number;
  responseRate: number;
}

export interface StatisticsSeriesPoint extends StatisticsBucket {
  applications: number;
  openings: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  count: number;
  /** Share of the applications in the range, 0-1. */
  share: number;
  /**
   * What to filter the applications list by to see these rows: a location or source text,
   * a work mode, a status or a company id. Null for "Unspecified" and "Other", which no
   * filter can express.
   */
  value: string | null;
}

export interface StatisticsSummary {
  range: { from: string; to: string; granularity: StatisticsGranularity; days: number };
  quick: QuickWindow[];
  totals: StatisticsTotals;
  series: StatisticsSeriesPoint[];
  /** One entry per day of the calendar, oldest first, starting on a Monday. */
  calendar: DailyCount[];
  byLocation: BreakdownRow[];
  bySource: BreakdownRow[];
  byWorkMode: BreakdownRow[];
  byStatus: BreakdownRow[];
  byCompany: BreakdownRow[];
}

// ---------------------------------------------------------------- aggregation

function countsByDay(dates: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of dates) counts.set(date, (counts.get(date) ?? 0) + 1);
  return counts;
}

function countBetween(counts: Map<string, number>, from: string, to: string): number {
  let total = 0;
  for (const [date, count] of counts) {
    if (date >= from && date <= to) total += count;
  }
  return total;
}

function quickWindows(daily: Map<string, number>, today: string): QuickWindow[] {
  const monday = startOfIsoWeek(today);
  const weekday = daysBetween(monday, today);
  const monthStart = startOfMonth(today);
  const lastMonthStart = startOfMonth(addDays(monthStart, -1));
  const lastMonthEnd = addDays(monthStart, -1);
  // Month to date against the same number of days into last month, so the 3rd is not
  // measured against all of a finished month.
  const lastMonthSamePoint = addDays(lastMonthStart, Math.min(daysBetween(monthStart, today), daysBetween(lastMonthStart, lastMonthEnd)));

  const windows: [QuickWindowKey, string, string, string, string, string, string][] = [
    ['today', 'Today', today, today, addDays(today, -1), addDays(today, -1), 'yesterday'],
    ['yesterday', 'Yesterday', addDays(today, -1), addDays(today, -1), addDays(today, -2), addDays(today, -2), 'the day before'],
    ['thisWeek', 'This week', monday, addDays(monday, 6), addDays(monday, -7), addDays(monday, weekday - 7), 'this point last week'],
    ['lastWeek', 'Last week', addDays(monday, -7), addDays(monday, -1), addDays(monday, -14), addDays(monday, -8), 'the week before'],
    ['thisMonth', 'This month', monthStart, endOfMonth(today), lastMonthStart, lastMonthSamePoint, 'this point last month'],
    ['last30', 'Last 30 days', addDays(today, -29), today, addDays(today, -59), addDays(today, -30), 'the 30 days before'],
  ];

  return windows.map(([key, label, from, to, previousFrom, previousTo, previousLabel]) => ({
    key,
    label,
    from,
    to,
    count: countBetween(daily, from, to),
    previous: countBetween(daily, previousFrom, previousTo),
    previousLabel,
  }));
}

function streakEnding(daily: Map<string, number>, today: string): number {
  let day = daily.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (daily.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

/** One application's group in a breakdown. */
interface Picked {
  key: string;
  label: string;
  /** The filter value; omitted means the label is it, null means no filter can express it. */
  value?: string | null;
}

/**
 * Count rows by a key, most common first, with the rest past `BREAKDOWN_ROWS` folded into
 * "Other". Each group is labeled with its most common spelling, so "stockholm" and
 * "Stockholm" count together and read the way most of them were typed.
 */
function breakdown(
  applications: readonly StatisticsApplication[],
  pick: (application: StatisticsApplication) => Picked | null,
  options: { unspecified?: string; order?: readonly string[] } = {},
): BreakdownRow[] {
  const total = applications.length;
  const groups = new Map<string, { count: number; value: Picked['value']; spellings: Map<string, number> }>();
  let unspecified = 0;

  for (const application of applications) {
    const picked = pick(application);
    if (!picked) {
      unspecified += 1;
      continue;
    }
    const group = groups.get(picked.key) ?? { count: 0, value: picked.value, spellings: new Map() };
    group.count += 1;
    group.spellings.set(picked.label, (group.spellings.get(picked.label) ?? 0) + 1);
    groups.set(picked.key, group);
  }

  const share = (count: number) => (total === 0 ? 0 : count / total);
  let rows: BreakdownRow[] = [...groups].map(([key, group]) => {
    const label = [...group.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    // A text filter takes the label, so it is spelled the way most records spell it.
    return { key, label, count: group.count, share: share(group.count), value: group.value === undefined ? label : group.value };
  });

  if (options.order) {
    const order = options.order;
    rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return rows;
  }

  rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (rows.length > BREAKDOWN_ROWS) {
    const rest = rows.slice(BREAKDOWN_ROWS).reduce((sum, row) => sum + row.count, 0);
    rows = [...rows.slice(0, BREAKDOWN_ROWS), { key: '__other', label: 'Other', count: rest, share: share(rest), value: null }];
  }
  if (unspecified > 0 && options.unspecified) {
    rows.push({ key: '__unspecified', label: options.unspecified, count: unspecified, share: share(unspecified), value: null });
  }
  return rows;
}

/**
 * The city part of a location: "Stockholm, Sweden" and "Stockholm" are the same place for
 * counting. The applications list filters locations by *contains*, so the city is also a
 * filter that finds every row counted under it.
 */
function locationGroup(location: string | null): Picked | null {
  const city = (location ?? '').split(',')[0]!.trim();
  if (!city) return null;
  return { key: normalizeText(city), label: city };
}

export function buildStatistics(input: StatisticsInput): StatisticsSummary {
  const { today } = input;
  const allDaily = countsByDay(input.applications.map((application) => application.appliedOn));

  const earliest = [...input.applications.map((a) => a.appliedOn), ...input.openings.map((o) => o.savedOn)].reduce(
    (min, date) => (date < min ? date : min),
    input.to ?? today,
  );
  const to = input.to ?? today;
  const from = input.from ?? earliest;
  const granularity = fittingGranularity(from, to, input.granularity ?? autoGranularity(from, to));

  const inRange = input.applications.filter((a) => a.appliedOn >= from && a.appliedOn <= to);
  const rangeDaily = countsByDay(inRange.map((a) => a.appliedOn));
  const openingDaily = countsByDay(input.openings.map((o) => o.savedOn));
  const previous = previousRange(from, to);

  let busiestDay: StatisticsTotals['busiestDay'] = null;
  for (const [date, count] of rangeDaily) {
    if (!busiestDay || count > busiestDay.count || (count === busiestDay.count && date > busiestDay.date)) {
      busiestDay = { date, count };
    }
  }
  const responded = inRange.filter((a) => a.status !== 'applied').length;

  const totals: StatisticsTotals = {
    applications: inRange.length,
    previousApplications: countBetween(allDaily, previous.from, previous.to),
    previousFrom: previous.from,
    previousTo: previous.to,
    openingsSaved: countBetween(openingDaily, from, to),
    openingsConverted: input.openings.filter((o) => o.convertedOn !== null && o.convertedOn >= from && o.convertedOn <= to).length,
    activeDays: rangeDaily.size,
    perActiveDay: rangeDaily.size === 0 ? 0 : inRange.length / rangeDaily.size,
    busiestDay,
    streak: streakEnding(allDaily, today),
    responded,
    responseRate: inRange.length === 0 ? 0 : responded / inRange.length,
  };

  const series = buckets(from, to, granularity).map((bucket) => ({
    ...bucket,
    applications: countBetween(rangeDaily, bucket.start, bucket.end),
    openings: countBetween(openingDaily, bucket.start, bucket.end),
  }));

  // The calendar ends with the range and starts on a Monday, so its columns are whole weeks.
  const earliestColumn = addDays(startOfIsoWeek(to), -(CALENDAR_WEEKS - 1) * 7);
  const calendarStart = startOfIsoWeek(from) > earliestColumn ? startOfIsoWeek(from) : earliestColumn;
  const calendar: DailyCount[] = [];
  for (let day = calendarStart; day <= to; day = addDays(day, 1)) {
    calendar.push({ date: day, count: day < from ? 0 : (rangeDaily.get(day) ?? 0) });
  }

  return {
    range: { from, to, granularity, days: daysBetween(from, to) + 1 },
    quick: quickWindows(allDaily, today),
    totals,
    series,
    calendar,
    byLocation: breakdown(inRange, (a) => locationGroup(a.location), { unspecified: 'Unspecified' }),
    bySource: breakdown(
      inRange,
      (a) => (a.sourceName?.trim() ? { key: normalizeText(a.sourceName), label: a.sourceName.trim() } : null),
      { unspecified: 'Unspecified' },
    ),
    byWorkMode: breakdown(
      inRange,
      (a) => ({ key: a.workMode, label: WORK_MODE_LABELS[a.workMode], value: a.workMode === 'unspecified' ? null : a.workMode }),
      { order: WORK_MODES },
    ),
    byStatus: breakdown(inRange, (a) => ({ key: a.status, label: STATUS_LABELS[a.status], value: a.status }), {
      order: APPLICATION_STATUSES,
    }),
    byCompany: breakdown(inRange, (a) => ({ key: a.companyId, label: a.companyName, value: a.companyId })),
  };
}
