/**
 * Dashboard figures.
 *
 * All of it derived from one read of the applications table plus one of the status events.
 * repolayer has no aggregation, so counting happens here — which at this scale is both
 * simpler and fewer round trips than issuing a `count()` per figure.
 */

import {
  ACTIVE_STATUSES,
  isActiveStatus,
  formatDateOnly,
  todayDateOnly,
  toPeriod,
  type ApplicationStatus,
  type JobApplicationView,
  type StatusEvent,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import { toStatus, toStatusEvent } from '../db/mappers.js';
import { hydrateApplications } from '../db/hydrate.js';

export interface DashboardStats {
  total: number;
  active: number;
  thisMonth: number;
  offers: number;
  rejected: number;
  /** Share of applications that ever drew any response at all, 0-1. */
  responseRate: number;
  byStatus: Record<string, number>;
}

export interface DashboardPayload {
  stats: DashboardStats;
  /** Follow-ups whose date has arrived, soonest first. */
  followUps: JobApplicationView[];
  /** The most recent movement across all applications. */
  recentActivity: (StatusEvent & { jobTitle: string; companyName: string })[];
}

export async function getDashboard(repos: Repos): Promise<DashboardPayload> {
  const today = todayDateOnly();
  const currentPeriod = toPeriod(today);

  const applications = await repos.applications.findMany({ where: { archived: false } });

  const byStatus: Record<string, number> = {};
  let active = 0;
  let thisMonth = 0;
  let responded = 0;

  for (const row of applications) {
    const status = toStatus(row.status);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (isActiveStatus(status)) active += 1;
    if (row.periodYear === currentPeriod.year && row.periodMonth === currentPeriod.month) {
      thisMonth += 1;
    }
    // Anything other than "applied" means somebody wrote back — including a rejection,
    // which is still a response and belongs in the rate.
    if (status !== 'applied') responded += 1;
  }

  const stats: DashboardStats = {
    total: applications.length,
    active,
    thisMonth,
    offers: byStatus.offer ?? 0,
    rejected: byStatus.rejected ?? 0,
    responseRate: applications.length > 0 ? responded / applications.length : 0,
    byStatus,
  };

  // Due follow-ups: the date has arrived and the conversation is still live.
  const dueRows = applications
    .filter(
      (row) =>
        row.followUpOn !== null &&
        formatDateOnly(row.followUpOn) <= today &&
        (ACTIVE_STATUSES as readonly string[]).includes(row.status),
    )
    .sort((a, b) => (a.followUpOn!.getTime() - b.followUpOn!.getTime()))
    .slice(0, 20);

  const [followUps, recentActivity] = await Promise.all([
    hydrateApplications(repos, dueRows),
    recentEvents(repos),
  ]);

  return { stats, followUps, recentActivity };
}

async function recentEvents(
  repos: Repos,
): Promise<(StatusEvent & { jobTitle: string; companyName: string })[]> {
  const events = await repos.statusEvents.findMany({
    orderBy: [{ field: 'createdAt', direction: 'desc' }],
    limit: 15,
  });
  if (events.length === 0) return [];

  const applicationIds = [...new Set(events.map((e) => e.applicationId))];
  const applications = await repos.applications.findMany({
    where: [{ field: 'id', op: 'in', value: applicationIds }],
  });

  const companyIds = [...new Set(applications.map((a) => a.companyId))];
  const companies =
    companyIds.length > 0
      ? await repos.companies.findMany({ where: [{ field: 'id', op: 'in', value: companyIds }] })
      : [];

  const appById = new Map(applications.map((a) => [a.id, a]));
  const companyById = new Map(companies.map((c) => [c.id, c]));

  return events
    .map((event) => {
      const application = appById.get(event.applicationId);
      if (!application) return null;
      return {
        ...toStatusEvent(event),
        jobTitle: application.jobTitle,
        companyName: companyById.get(application.companyId)?.name ?? '(unknown company)',
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export type { ApplicationStatus };
