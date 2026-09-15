/** Dashboard summary and statistics — mirrors `dashboard.routes.ts`. */

import { z } from 'zod';
import { statisticsQuerySchema } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import { getDashboard } from '@jobtrack/api/services/dashboard';
import { getStatistics } from '@jobtrack/api/services/statistics';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { jsonResult } from '../helpers.js';

/**
 * How many applications a statistics result lists. The counts cover the whole range; the
 * list is for naming them, and an all-time list would blow past a client's result ceiling.
 */
const MAX_LISTED = 100;

export function registerDashboardTool(server: McpServer, deps: Deps): void {
  server.registerTool(
    'get_dashboard',
    {
      description:
        'Summary figures: totals by status, this-month count, response rate, due follow-ups, and the most recent status changes.',
      inputSchema: z.object({}),
    },
    async () => jsonResult(await getDashboard(deps.repos)),
  );

  server.registerTool(
    'get_statistics',
    {
      description:
        "How many applications went out over a stretch of days, and where they went. `from`/`to` (YYYY-MM-DD) pick the range; without them it covers everything on file. Returns `quick` counts for today, yesterday, this week (Monday to Sunday), last week, this month and the last 30 days, each with the count for the stretch before; `totals` for the range (with the previous equal stretch, openings saved and converted, active days, streak, response rate); a `series` per day, week or month (`granularity`, chosen from the range length when omitted); breakdowns by location (city), source, work mode, status and company; and the `applications` in the range, newest first, capped at " +
        MAX_LISTED +
        ". Archived applications count unless `archived: 'false'`.",
      inputSchema: statisticsQuerySchema,
    },
    async (query) => {
      const { applications, calendar: _calendar, ...summary } = await getStatistics(deps.repos, query);
      return jsonResult({
        ...summary,
        applicationCount: applications.length,
        applications: applications.slice(0, MAX_LISTED).map((row) => ({
          id: row.id,
          appliedOn: row.appliedOn,
          company: row.company.name,
          jobTitle: row.jobTitle,
          status: row.status,
          ...(row.location ? { location: row.location } : {}),
          ...(row.sourceName ? { source: row.sourceName } : {}),
          ...(row.jobUrl ? { jobUrl: row.jobUrl } : {}),
        })),
      });
    },
  );
}

