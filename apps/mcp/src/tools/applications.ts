/**
 * Application tools — list/get/check-duplicate (read) and create/update/change-status
 * (write; no delete, by design). Every tool's `inputSchema` is the exact zod schema its REST
 * counterpart validates against (`@jobtrack/shared`), so a tool call can never accept
 * something the web form would reject, or vice versa.
 */

import { z } from 'zod';
import {
  applicationFilterSchema,
  changeStatusSchema,
  createApplicationSchema,
  duplicateCheckSchema,
  patchApplicationSchema,
} from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import {
  changeStatus,
  computePeriods,
  createApplication,
  getApplication,
  listApplications,
  patchApplication,
} from '@jobtrack/api/services/applications';
import { checkDuplicates } from '@jobtrack/api/services/duplicates';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorResult, jsonResult } from '../helpers.js';

const idOnly = z.object({ id: z.string().min(1) });

export function registerApplicationTools(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'list_applications',
    {
      description:
        'List job applications with the same filters the web app supports: status, work mode, tags, company, date range, archived, follow-up due, and a free-text `q` that runs the hybrid (lexical + semantic) search.',
      inputSchema: applicationFilterSchema,
    },
    async (filter) => {
      let orderedIds: string[] | null = null;
      if (filter.q) {
        const outcome = await search.search(filter.q, { limit: 200, types: ['application'] });
        orderedIds = outcome.hits.map((hit) => hit.entityId);
      }
      return jsonResult(await listApplications(repos, filter, { orderedIds }));
    },
  );

  server.registerTool(
    'get_application',
    {
      description: 'Get one application by id, including its status history and notes.',
      inputSchema: idOnly,
    },
    async ({ id }) => {
      const application = await getApplication(repos, id);
      return application ? jsonResult(application) : errorResult(`No application with id ${id}`);
    },
  );

  server.registerTool(
    'get_periods',
    { description: 'The year/month tree of application counts, newest year first.', inputSchema: z.object({}) },
    async () => jsonResult(await computePeriods(repos)),
  );

  server.registerTool(
    'check_duplicate',
    {
      description:
        "Check whether an application already exists for a company/title before creating a new one. Always call this before create_application unless you already know the answer — an 'exact' verdict means it almost certainly already exists.",
      inputSchema: duplicateCheckSchema,
    },
    async (input) => jsonResult(await checkDuplicates(repos, search, input)),
  );

  server.registerTool(
    'create_application',
    {
      description:
        'Create a new job application. The company is resolved by name — an existing company with a matching name is reused, otherwise one is created — so there is no need to look up a company id first.',
      inputSchema: createApplicationSchema,
    },
    async (input) => {
      const created = await createApplication(repos, input);
      search.markStale();
      return jsonResult(created);
    },
  );

  server.registerTool(
    'update_application',
    {
      description: "Update fields on an existing application. Only the fields set in `patch` are changed.",
      inputSchema: z.object({ id: z.string().min(1), patch: patchApplicationSchema }),
    },
    async ({ id, patch }) => {
      const updated = await patchApplication(repos, id, patch);
      if (!updated) return errorResult(`No application with id ${id}`);
      search.markStale();
      return jsonResult(updated);
    },
  );

  server.registerTool(
    'change_application_status',
    {
      description:
        'Advance or correct an application\'s status. Always records a dated status-history entry, unlike update_application setting status directly would not.',
      inputSchema: z.object({ id: z.string().min(1), patch: changeStatusSchema }),
    },
    async ({ id, patch }) => {
      const updated = await changeStatus(repos, id, patch);
      if (!updated) return errorResult(`No application with id ${id}`);
      search.markStale();
      return jsonResult(updated);
    },
  );
}
