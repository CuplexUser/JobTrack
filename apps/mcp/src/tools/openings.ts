/**
 * Job opening tools — saved opportunities, and converting one into a real application.
 * Mirrors `openings.routes.ts` minus delete.
 */

import { z } from 'zod';
import { convertJobOpeningSchema, createJobOpeningSchema, patchJobOpeningSchema } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import {
  convertOpening,
  createOpening,
  getOpening,
  listOpenings,
  updateOpening,
} from '@jobtrack/api/services/openings';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorResult, jsonResult } from '../helpers.js';

const idOnly = z.object({ id: z.string().min(1) });

export function registerOpeningTools(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'list_openings',
    {
      description:
        "List saved job openings — opportunities found but not yet applied to. Excludes converted/dismissed openings unless includeArchived is set.",
      inputSchema: z.object({ includeArchived: z.boolean().optional() }),
    },
    async ({ includeArchived }) => jsonResult(await listOpenings(repos, { includeArchived })),
  );

  server.registerTool(
    'get_opening',
    { description: 'Get one saved job opening by id.', inputSchema: idOnly },
    async ({ id }) => {
      const opening = await getOpening(repos, id);
      return opening ? jsonResult(opening) : errorResult(`No opening with id ${id}`);
    },
  );

  server.registerTool(
    'create_opening',
    {
      description:
        "Save a job opportunity for later — when you don't have time to apply right now or don't have all the details yet. Lighter-weight than create_application: no status, no tags.",
      inputSchema: createJobOpeningSchema,
    },
    async (input) => jsonResult(await createOpening(repos, input)),
  );

  server.registerTool(
    'update_opening',
    {
      description: 'Update fields on a saved opening. Only the fields set in `patch` are changed.',
      inputSchema: z.object({ id: z.string().min(1), patch: patchJobOpeningSchema }),
    },
    async ({ id, patch }) => {
      const opening = await updateOpening(repos, id, patch);
      return opening ? jsonResult(opening) : errorResult(`No opening with id ${id}`);
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
