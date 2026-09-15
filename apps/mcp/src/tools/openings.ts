/**
 * Job opening tools — saved opportunities, and converting one into a real application.
 * Mirrors `openings.routes.ts` minus delete.
 */

import { z } from 'zod';
import {
  convertJobOpeningSchema,
  createOpeningToolSchema,
  openingFilterSchema,
  patchJobOpeningSchema,
  type JobOpeningView,
} from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import {
  convertOpening,
  createOpening,
  getOpening,
  updateOpening,
} from '@jobtrack/api/services/openings';
import { fitOpening, rankOpenings } from '@jobtrack/api/services/fit';
import { assertNewPosting } from '@jobtrack/api/services/ingest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { duplicateRefusal, errorResult, jsonResult } from '../helpers.js';
import { fitSummary, openingSummary } from '../views.js';

const idOnly = z.object({ id: z.string().min(1) });

export function registerOpeningTools(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  /** The opening with its fit alongside, so saving or editing one says how well it matches. */
  async function withFit(opening: JobOpeningView) {
    const { fit } = await fitOpening(repos, search, opening);
    return fit ? { ...opening, fit: fitSummary(fit) } : opening;
  }

  server.registerTool(
    'list_openings',
    {
      description:
        "List saved job openings: opportunities found but not yet applied to, newest first. Excludes converted/dismissed openings unless includeArchived is set. Filter with `q` (words that must all appear in the title, company, location or notes), `location` (any of several, case- and accent-insensitive contains) and `source`. When the user has a profile, each row carries `fit` (0 to 100, with the reasons that raised or lowered it); `sort: 'fit'` ranks by it and `minFit` drops weak matches. Notes come back cut to a preview; call get_opening for one in full.",
      inputSchema: openingFilterSchema,
    },
    async (filter) => jsonResult((await rankOpenings(repos, search, filter)).map(openingSummary)),
  );

  server.registerTool(
    'get_opening',
    {
      description: "Get one saved job opening by id, in full. Carries `fit` (0 to 100, with reasons) when the user has a profile.",
      inputSchema: idOnly,
    },
    async ({ id }) => {
      const opening = await getOpening(repos, id);
      return opening ? jsonResult(await withFit(opening)) : errorResult(`No opening with id ${id}`);
    },
  );

  server.registerTool(
    'create_opening',
    {
      description:
        "Save a job opportunity for later, when you don't have time to apply right now or don't have all the details yet. Lighter-weight than create_application: no status, no tags. The saved opening comes back with its `fit` when the user has a profile. To judge a posting before saving it, use score_postings. Refuses a posting that is already saved as an opening or already applied to (same link, or same company and title when a link is missing): the result is `saved: false` with the `reason` and the `existing` record. Tell the user; only if they still want a second copy, call again with `allowDuplicate: true`.",
      inputSchema: createOpeningToolSchema,
    },
    async ({ allowDuplicate, ...input }) => {
      if (!allowDuplicate) {
        try {
          await assertNewPosting(repos, input);
        } catch (error) {
          const refusal = duplicateRefusal(error);
          if (refusal) return jsonResult(refusal);
          throw error;
        }
      }
      return jsonResult(await withFit(await createOpening(repos, input)));
    },
  );

  server.registerTool(
    'update_opening',
    {
      description: 'Update fields on a saved opening. Only the fields set in `patch` are changed.',
      inputSchema: z.object({ id: z.string().min(1), patch: patchJobOpeningSchema }),
    },
    async ({ id, patch }) => {
      const opening = await updateOpening(repos, id, patch);
      return opening ? jsonResult(await withFit(opening)) : errorResult(`No opening with id ${id}`);
    },
  );

  server.registerTool(
    'convert_opening_to_application',
    {
      description:
        "Turn a saved opening into a real, tracked application once you're ready to apply. The opening is kept (marked archived) rather than deleted, so its history is not lost.",
      inputSchema: z.object({ id: z.string().min(1), patch: convertJobOpeningSchema }),
    },
    async ({ id, patch }) => {
      const application = await convertOpening(repos, id, patch);
      if (!application) return errorResult(`No opening with id ${id}`);
      search.markStale();
      return jsonResult(application);
    },
  );
}
