/**
 * Running the automation rules that change records on their own: today, marking long-silent
 * applications as ghosted.
 *
 * Built to be safe to run at any time and any number of times. It only ever moves an
 * application forward to `ghosted` through `changeStatus`, so every change lands in the status
 * history with a comment saying why, and an application it already moved is no longer a
 * candidate. That is what lets the scheduler simply run it every hour, from every process,
 * with no record of when it last ran.
 */

import {
  AUTO_GHOST_STATUSES,
  daysBetween,
  formatDateOnly,
  todayDateOnly,
  type JobApplicationView,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import { hydrateApplications } from '../db/hydrate.js';
import { changeStatus } from './applications.service.js';
import { getRules } from './settings.service.js';

export interface AutoGhostCandidate extends JobApplicationView {
  /** The last thing that happened: a status change, the application itself, or a follow-up date. */
  silentSince: string;
  silentDays: number;
}

export interface AutoGhostResult {
  /** The rule's setting when it ran; null means the rule is off and nothing was considered. */
  afterDays: number | null;
  candidates: AutoGhostCandidate[];
  /** How many were actually changed. Zero on a dry run. */
  changed: number;
}

export function autoGhostComment(days: number): string {
  return `Marked ghosted automatically after ${days} days without a response`;
}

/**
 * The applications the rule would ghost today.
 *
 * Silence runs from the latest of: the application date, its last status change, and its
 * follow-up date. So a follow-up the user has planned for next week keeps an application out
 * of reach, while a follow-up that came and went long ago does not.
 */
export async function findAutoGhostCandidates(
  repos: Repos,
  afterDays: number,
  today: string = todayDateOnly(),
): Promise<AutoGhostCandidate[]> {
  const applications = await repos.applications.findMany({
    where: [
      { field: 'archived', op: 'eq', value: false },
      { field: 'status', op: 'in', value: [...AUTO_GHOST_STATUSES] },
    ],
  });
  if (applications.length === 0) return [];

  const events = await repos.statusEvents.findMany({
    where: [{ field: 'applicationId', op: 'in', value: applications.map((row) => row.id) }],
  });
  const lastEvent = new Map<string, string>();
  for (const event of events) {
    const on = formatDateOnly(event.occurredOn);
    const current = lastEvent.get(event.applicationId);
    if (!current || on > current) lastEvent.set(event.applicationId, on);
  }

  const due = applications
    .map((row) => {
      const dates = [formatDateOnly(row.appliedOn), lastEvent.get(row.id), row.followUpOn ? formatDateOnly(row.followUpOn) : undefined];
      const silentSince = dates.filter((date): date is string => Boolean(date)).sort().at(-1)!;
      return { row, silentSince, silentDays: daysBetween(silentSince, today) };
    })
    .filter((entry) => entry.silentDays >= afterDays)
    .sort((a, b) => b.silentDays - a.silentDays);

  const views = await hydrateApplications(repos, due.map((entry) => entry.row));
  return views.map((view, index) => ({ ...view, silentSince: due[index]!.silentSince, silentDays: due[index]!.silentDays }));
}

/** Apply the auto-ghost rule as currently configured. With `dryRun`, only report what it would do. */
export async function runAutoGhost(repos: Repos, options: { dryRun?: boolean } = {}): Promise<AutoGhostResult> {
  const { autoGhostAfterDays } = await getRules(repos);
  if (autoGhostAfterDays === null) return { afterDays: null, candidates: [], changed: 0 };

  const candidates = await findAutoGhostCandidates(repos, autoGhostAfterDays);
  if (options.dryRun) return { afterDays: autoGhostAfterDays, candidates, changed: 0 };

  let changed = 0;
  for (const candidate of candidates) {
    const updated = await changeStatus(repos, candidate.id, {
      status: 'ghosted',
      comment: autoGhostComment(autoGhostAfterDays),
    });
    if (updated) changed += 1;
  }
  return { afterDays: autoGhostAfterDays, candidates, changed };
}
