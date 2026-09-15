/**
 * Statistics: application volume over a chosen stretch of days, and where it went.
 *
 * One read of applications, one of openings, one of the companies involved; everything
 * else is `buildStatistics` in the shared package, which is where the counting rules live
 * and are tested. Like the dashboard, this reads whole tables and tallies in memory, since
 * repolayer has no GROUP BY and a personal tracker's tables are small.
 */

import {
  buildStatistics,
  todayDateOnly,
  type ApplicationStatus,
  type StatisticsQuery,
  type StatisticsSummary,
  type WorkMode,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import { toApplication, toCompany, toOpening } from '../db/mappers.js';

/** One application in the range, with what a table row and its links need. */
export interface StatisticsApplicationRow {
  id: string;
  appliedOn: string;
  jobTitle: string;
  company: { id: string; name: string };
  location: string | null;
  workMode: WorkMode;
  sourceName: string | null;
  status: ApplicationStatus;
  jobUrl: string | null;
  archived: boolean;
}

export interface StatisticsPayload extends StatisticsSummary {
  /** Every application in the range, newest first. */
  applications: StatisticsApplicationRow[];
}

export async function getStatistics(
  repos: Repos,
  query: StatisticsQuery,
  today: string = todayDateOnly(),
): Promise<StatisticsPayload> {
  const [applicationRows, openingRows, companyRows] = await Promise.all([
    repos.applications.findMany(query.archived === 'false' ? { where: { archived: false } } : {}),
    repos.jobOpenings.findMany({}),
    repos.companies.findMany({}),
  ]);

  const applications = applicationRows.map(toApplication);
  const companyName = new Map(companyRows.map((row) => [row.id, toCompany(row).name]));
  const appliedOn = new Map(applications.map((application) => [application.id, application.appliedOn]));

  const summary = buildStatistics({
    applications: applications.map((application) => ({
      ...application,
      companyName: companyName.get(application.companyId) ?? '(unknown company)',
    })),
    // Openings are counted whatever the archive setting: converting one archives it, and a
    // converted opening is exactly the kind worth counting.
    openings: openingRows.map(toOpening).map((opening) => ({
      savedOn: opening.savedOn,
      convertedOn: opening.convertedApplicationId ? (appliedOn.get(opening.convertedApplicationId) ?? null) : null,
    })),
    from: query.from,
    to: query.to,
    granularity: query.granularity,
    today,
  });

  const { from, to } = summary.range;
  const inRange = applications
    .filter((application) => application.appliedOn >= from && application.appliedOn <= to)
    .sort((a, b) => b.appliedOn.localeCompare(a.appliedOn) || b.createdAt.localeCompare(a.createdAt))
    .map((application) => ({
      id: application.id,
      appliedOn: application.appliedOn,
      jobTitle: application.jobTitle,
      company: { id: application.companyId, name: companyName.get(application.companyId) ?? '(unknown company)' },
      location: application.location,
      workMode: application.workMode,
      sourceName: application.sourceName,
      status: application.status,
      jobUrl: application.jobUrl,
      archived: application.archived,
    }));

  return { ...summary, applications: inRange };
}
