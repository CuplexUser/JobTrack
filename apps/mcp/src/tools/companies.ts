/** Company tools — mirrors `companies.routes.ts` minus delete. */

import { z } from 'zod';
import { applicationFilterSchema, createCompanySchema, patchCompanySchema } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import { createCompany, getCompanyWithTags, listCompanies, updateCompany } from '@jobtrack/api/services/companies';
import { listApplications } from '@jobtrack/api/services/applications';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorResult, jsonResult } from '../helpers.js';

const idOnly = z.object({ id: z.string().min(1) });

export function registerCompanyTools(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'list_companies',
    {
      description: 'List companies with their application counts and tags.',
      inputSchema: z.object({
        archived: z.boolean().optional(),
        q: z.string().optional().describe('Filter by name, case-insensitive substring match'),
      }),
    },
    async ({ archived, q }) =>
      jsonResult(await listCompanies(repos, { includeArchived: archived ?? false, ...(q ? { search: q } : {}) })),
  );

  server.registerTool(
    'get_company',
    {
      description: "Get one company by id, with its tags and its full application history.",
      inputSchema: idOnly,
    },
    async ({ id }) => {
      const company = await getCompanyWithTags(repos, id);
      if (!company) return errorResult(`No company with id ${id}`);
      const filter = applicationFilterSchema.parse({ companyId: id, limit: 200, archived: 'all' });
      const applications = await listApplications(repos, filter);
      return jsonResult({ company, applications: applications.items });
    },
  );

  server.registerTool(
    'create_company',
    { description: 'Create a new company directly (applications normally create one implicitly by name).', inputSchema: createCompanySchema },
    async (input) => {
      const company = await createCompany(repos, input);
      search.markStale();
      return jsonResult(company);
    },
  );

  server.registerTool(
    'update_company',
    {
      description: 'Update fields on an existing company. Only the fields set in `patch` are changed.',
      inputSchema: z.object({ id: z.string().min(1), patch: patchCompanySchema }),
    },
    async ({ id, patch }) => {
      const company = await updateCompany(repos, id, patch);
      search.markStale();
      return jsonResult(company);
    },
  );
}
