/**
 * Where the user looks for jobs: the job platforms they browse and the APIs an assistant can
 * query, each list in the user's priority order. Reference only. JobTrack does not call any
 * of these; the point is that an assistant searching on the user's behalf starts where the
 * user would, rather than wherever it happens to know about.
 */

import { z } from 'zod';
import { jobSourcesPatchSchema, type JobSource } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import { getJobSources, updateJobSources } from '@jobtrack/api/services/settings';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { jsonResult } from '../helpers.js';

/** Numbered from 1 in list order, so "search in priority order" needs no counting. */
function ranked(sources: JobSource[], includeDisabled: boolean) {
  return sources
    .filter((source) => includeDisabled || source.enabled)
    .map((source, index) => ({ priority: index + 1, ...source }));
}

export function registerSourceTools(server: McpServer, deps: Deps): void {
  const { repos } = deps;

  server.registerTool(
    'get_job_sources',
    {
      description:
        "Where the user looks for jobs: `platforms` (job boards and sites to browse) and `apis` (job APIs you can query, such as JobTech Jobsearch for Swedish ads), each in the user's priority order with priority 1 first. Call this before searching for openings on the user's behalf and work through the sources in that order, following each one's notes. Only enabled sources are returned unless includeDisabled is true.",
      inputSchema: z.object({
        includeDisabled: z.boolean().default(false),
      }),
    },
    async ({ includeDisabled }) => {
      const sources = await getJobSources(repos);
      return jsonResult({
        platforms: ranked(sources.platforms, includeDisabled),
        apis: ranked(sources.apis, includeDisabled),
      });
    },
  );

  server.registerTool(
    'update_job_sources',
    {
      description:
        'Change the job platforms or APIs the user searches. Each list is replaced as a whole and its order is the priority, best first, so call get_job_sources with includeDisabled: true first and send the full list back with your change. A list left out is kept. Do not include the `priority` field; the order sets it. Confirm with the user before changing these.',
      inputSchema: jobSourcesPatchSchema,
    },
    async (patch) => jsonResult(await updateJobSources(repos, patch)),
  );
}
