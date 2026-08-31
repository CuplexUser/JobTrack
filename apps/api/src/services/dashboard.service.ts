/**
 * Dashboard figures.
 *
 * All of it derived from one read of the applications table plus one of the status events.
 * repolayer has no aggregation, so counting happens here — which at this scale is both
 * simpler and fewer round trips than issuing a `count()` per figure.
 */

import {
  ACTIVE_STATUSES,
  STATUS_PROGRESSION,
  isActiveStatus,
  formatDateOnly,
  parseDateOnly,
  todayDateOnly,
  toPeriod,
  type ApplicationStatus,
  type JobApplicationView,
  type StatusEvent,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import type { ApplicationRow, StatusEventRow } from '../db/schema.js';
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

/** One step of the pipeline, counted by what applications *reached* rather than where they sit now. */
export interface FunnelStage {
  status: ApplicationStatus;
  /** Applications that ever got this far, whatever happened afterwards. */
  count: number;
  /** Share of the previous stage that made it here, 0-1. Null for the first stage. */
  conversion: number | null;
}

/** One month's application count, for the volume chart. Months with none are included. */
export interface VolumePoint {
  year: number;
  month: number;
  count: number;
}

export interface StaleApplication extends JobApplicationView {
  /** The date of the last thing that happened — a status change, or the application itself. */
  silentSince: string;
  silentDays: number;
}

export interface DashboardPayload {
  stats: DashboardStats;
  /** Follow-ups whose date has arrived, soonest first. */
  followUps: JobApplicationView[];
  /** The most recent movement across all applications. */
  recentActivity: (StatusEvent & { jobTitle: string; companyName: string })[];
  /** applied -> screening -> interview -> offer, from the status history. */
  funnel: FunnelStage[];
  /** The last 24 months, oldest first. */
  volume: VolumePoint[];
  /** Live applications nothing has happened to in a while, longest silence first. */
  stale: StaleApplication[];
}

/**
 * How long an application can go without a word before it is worth a second look.
 *
 * Three weeks is late enough that a reply was likely coming if it were coming, and early
 * enough to still be worth a nudge — and it is a *prompt*, never an automatic status change.
 */
export const STALE_AFTER_DAYS = 21;

/** How much history the volume chart shows. Two years covers a long search without crowding. */
const VOLUME_MONTHS = 24;

export async function getDashboard(repos: Repos): Promise<DashboardPayload> {
  const today = todayDateOnly();
  const currentPeriod = toPeriod(today);

  const applications = await repos.applications.findMany({ where: { archived: false } });
  // Every figure below that needs history comes out of this one read: the funnel, and how
  // long each application has been silent.
  const events = await repos.statusEvents.findMany({});

  const byStatus: Record<string, number> = {};
  const monthly = new Map<string, number>();
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

    const key = `${row.periodYear}-${row.periodMonth}`;
    monthly.set(key, (monthly.get(key) ?? 0) + 1);
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

  const [followUps, recentActivity, stale] = await Promise.all([
    hydrateApplications(repos, dueRows),
    recentEvents(repos),
    staleApplications(repos, applications, events, today),
  ]);

  return {
    stats,
    followUps,
    recentActivity,
    funnel: buildFunnel(applications, events),
    volume: buildVolume(monthly, currentPeriod),
    stale,
  };
}

/**
 * The funnel, from history rather than from where each application currently sits.
 *
 * This is the difference between a useful chart and a misleading one. Counting by *current*
 * status puts an application that interviewed and was then turned down under "rejected"
 * alone — so the interview stage shows only the people still interviewing, and the
 * conversion rate you actually want ("how often does applying turn into an interview?")
 * cannot be read off it at all. Counting what each application *ever reached* answers it.
 *
 * One deliberate limit: an application imported straight in at `interview` has no earlier
 * history, and none is invented for it. Inferring the stages it "must have" passed through
 * would quietly inflate every conversion rate above it.
 */
function buildFunnel(applications: ApplicationRow[], events: StatusEventRow[]): FunnelStage[] {
  const live = new Set(applications.map((row) => row.id));
  const reached = new Map<string, Set<string>>();

  const record = (applicationId: string, status: string | null): void => {
    if (status === null || !live.has(applicationId)) return;
    const set = reached.get(applicationId) ?? new Set<string>();
    set.add(status);
    reached.set(applicationId, set);
  };

  for (const event of events) {
    record(event.applicationId, event.toStatus);
    // The status an application moved *out of* is one it was in, even if the event that put
    // it there is missing — a restored backup, say.
    record(event.applicationId, event.fromStatus);
  }
  // An application with no history at all still counts as having reached where it is.
  for (const row of applications) {
    if (!reached.has(row.id)) record(row.id, row.status);
  }

  let previous: number | null = null;
  return STATUS_PROGRESSION.map((status) => {
    let count = 0;
    for (const set of reached.values()) {
      if (set.has(status)) count += 1;
    }
    const stage: FunnelStage = {
      status,
      count,
      conversion: previous === null || previous === 0 ? null : count / previous,
    };
    previous = count;
    return stage;
  });
}

/** The last two months-worth of activity, gaps included — a month with nothing is information. */
function buildVolume(monthly: Map<string, number>, current: { year: number; month: number }): VolumePoint[] {
  const points: VolumePoint[] = [];
  for (let back = VOLUME_MONTHS - 1; back >= 0; back -= 1) {
    // Month arithmetic through a zero-based index, so December rolls the year properly.
    const index = current.year * 12 + (current.month - 1) - back;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    points.push({ year, month, count: monthly.get(`${year}-${month}`) ?? 0 });
  }
  return points;
}

/**
 * Live applications nothing has happened to in a while.
 *
 * The complement to the follow-up list rather than a duplicate of it: a follow-up appears
 * because you set a date, and this appears because you did not. Those are exactly the
 * applications that go quiet and stay quiet — the ones a tracker is supposed to catch.
 */
async function staleApplications(
  repos: Repos,
  applications: ApplicationRow[],
  events: StatusEventRow[],
  today: string,
): Promise<StaleApplication[]> {
  const lastEventAt = new Map<string, Date>();
  for (const event of events) {
    const current = lastEventAt.get(event.applicationId);
    if (!current || event.occurredOn > current) lastEventAt.set(event.applicationId, event.occurredOn);
  }

  const todayMs = parseDateOnly(today).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const candidates = applications
    .filter((row) => isActiveStatus(toStatus(row.status)) && row.followUpOn === null)
    .map((row) => {
      const since = lastEventAt.get(row.id) ?? row.appliedOn;
      return { row, since, days: Math.floor((todayMs - since.getTime()) / dayMs) };
    })
    .filter((entry) => entry.days >= STALE_AFTER_DAYS)
    .sort((a, b) => b.days - a.days)
    .slice(0, 20);

  const views = await hydrateApplications(repos, candidates.map((entry) => entry.row));
  return views.map((view, index) => ({
    ...view,
    silentSince: formatDateOnly(candidates[index]!.since),
    silentDays: candidates[index]!.days,
  }));
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
