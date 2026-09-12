/**
 * Application tools — list/get/check-duplicate/find-duplicates (read) and
 * create/update/change-status/bulk-change-status (write; no delete, by design). Every tool's `inputSchema` is the exact zod schema its REST
 * counterpart validates against (`@jobtrack/shared`), so a tool call can never accept
 * something the web form would reject, or vice versa.
 */

import { z } from 'zod';
import {
  applicationFilterSchema,
  bulkStatusChangeSchema,
  changeStatusSchema,
  createApplicationSchema,
  duplicateCheckSchema,
  patchApplicationSchema,
} from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import {
  changeStatus,
  changeStatuses,
  computePeriods,
  createApplication,
  getApplication,
  listApplications,
  patchApplication,
} from '@jobtrack/api/services/applications';
import { checkDuplicates, findDuplicateGroups } from '@jobtrack/api/services/duplicates';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorResult, jsonResult } from '../helpers.js';
import { applicationSummary } from '../views.js';

const idOnly = z.object({ id: z.string().min(1) });

export function registerApplicationTools(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'list_applications',
    {
      description:
        'List job applications with the same filters the web app supports: status, work mode, tags, location (any of several, matched as a case- and accent-insensitive contains, so "Stockholm" also finds "Stockholm, Sweden"), company, date range, archived, follow-up due, and a free-text `q` that runs the hybrid (lexical + semantic) search. Rows come back summarized. Call get_application for one record in full, including its status history and notes.',
      inputSchema: applicationFilterSchema,
    },
    async (filter) => {
      let orderedIds: string[] | null = null;
      if (filter.q) {
        const outcome = await search.search(filter.q, { limit: 200, types: ['application'] });
        orderedIds = outcome.hits.map((hit) => hit.entityId);
      }
      const page = await listApplications(repos, filter, { orderedIds });
      return jsonResult({ ...page, items: page.items.map(applicationSummary) });
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
        "Check whether an application already exists for a company/title before creating a new one. Always call this before create_application unless you already know the answer. An 'exact' verdict means it almost certainly already exists.",
      inputSchema: duplicateCheckSchema,
    },
    async (input) => jsonResult(await checkDuplicates(repos, search, input)),
  );

  server.registerTool(
    'find_duplicate_groups',
    {
      description:
        "Sweep every stored application for repeats of each other, grouped by employer. 'exact' groups are the same normalized title at the same company; 'similar' groups match on wording or meaning and need judgment (two real applications a year apart can look alike). Each group names the record the scan recommends keeping. Read-only: removing duplicates is done by the user in the web app.",
      inputSchema: z.object({}),
    },
    async () => {
      const scan = await findDuplicateGroups(repos);
      return jsonResult({
        scanned: scan.scanned,
        groups: scan.groups.map((group) => ({ ...group, members: group.members.map(applicationSummary) })),
      });
    },
  );

  server.registerTool(
    'create_application',
    {
      description:
        'Create a new job application. The company is resolved by name (an existing company with a matching name is reused, otherwise one is created), so there is no need to look up a company id first.',
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

  server.registerTool(
    'bulk_change_status',
    {
      description:
        "Apply one status change to several applications at once, such as marking a batch of silent applications 'ghosted' after a weekly review. Each application gets its own dated status-history entry, the same as change_application_status. Applications already at that status are reported as unchanged and left alone. Confirm the list with the user before calling this.",
      inputSchema: bulkStatusChangeSchema,
    },
    async ({ ids, ...change }) => {
      const result = await changeStatuses(repos, ids, change);
      if (result.changed.length > 0) search.markStale();
      return jsonResult({ ...result, changed: result.changed.map(applicationSummary) });
    },
  );
}
