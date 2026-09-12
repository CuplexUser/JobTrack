/**
 * The parts of the automation rules that are pure date arithmetic, kept here so the API and
 * its tests agree on them without a database.
 */

import { formatDateOnly, parseDateOnly } from './periods.js';
import { isActiveStatus, type ApplicationStatus } from './types.js';

/** A calendar day `days` after `date`, both YYYY-MM-DD. Negative goes backwards. */
export function addDays(date: string, days: number): string {
  const result = parseDateOnly(date);
  result.setUTCDate(result.getUTCDate() + days);
  return formatDateOnly(result);
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDateOnly(to).getTime() - parseDateOnly(from).getTime()) / 86_400_000);
}

/**
 * The follow-up date the default-follow-up rule gives a new application, or null for none.
 *
 * Only a live application gets one, and never a date already in the past: importing last
 * year's applications should not flood the dashboard with follow-ups that were due months ago.
 */
export function defaultFollowUpDate(
  defaultFollowUpDays: number | null,
  appliedOn: string,
  status: ApplicationStatus,
  today: string,
): string | null {
  if (defaultFollowUpDays === null || !isActiveStatus(status)) return null;
  const date = addDays(appliedOn, defaultFollowUpDays);
  return date >= today ? date : null;
}

/**
 * The statuses the auto-ghost rule may move to `ghosted`. Not `interview`: going quiet after
 * an interview is common while a decision is made, and not something to close out unasked.
 */
export const AUTO_GHOST_STATUSES = ['applied', 'screening'] as const satisfies readonly ApplicationStatus[];
