/**
 * Calendar handling for the year/month division.
 *
 * Every date in this app is a *calendar day*, not an instant: "applied on 1 March" must
 * stay 1 March regardless of the machine's timezone. So date-only values are parsed and
 * formatted strictly in UTC. Reading them back with local getters is the classic way an
 * application silently lands in the previous month for anyone west of Greenwich, and the
 * denormalized `periodYear`/`periodMonth` columns would then disagree with `appliedOn`.
 */

export interface Period {
  year: number;
  month: number; // 1-12
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` into a Date pinned to UTC midnight. Throws on anything else. */
export function parseDateOnly(value: string): Date {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${JSON.stringify(value)}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 2026-02-30 and friends, which Date.UTC would silently roll forward.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Not a real calendar date: ${value}`);
  }
  return date;
}

/** Format a Date as `YYYY-MM-DD` using its UTC parts. */
export function formatDateOnly(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Derive the period columns from a date. This is the single definition of how `appliedOn`
 * becomes `periodYear`/`periodMonth`; the API calls it on every write so the two can never
 * disagree.
 */
export function toPeriod(value: string | Date): Period {
  const date = typeof value === 'string' ? parseDateOnly(value) : value;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** Today as a calendar day, in the viewer's own timezone, expressed as `YYYY-MM-DD`. */
export function todayDateOnly(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? `Month ${month}`;
}

/** `2026-03` — the stable key used for period tree nodes and export sheet grouping. */
export function periodKey(period: Period): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

/**
 * Date-only strings sort correctly as plain strings, which is why comparisons throughout
 * the app are string comparisons rather than Date arithmetic.
 */
export function isOnOrBefore(a: string, b: string): boolean {
  return a <= b;
}
