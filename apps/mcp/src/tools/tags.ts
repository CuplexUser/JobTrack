/** Tag tools — mirrors `tags.routes.ts` minus delete. */

import { z } from 'zod';
import { createTagSchema } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import { listTags, resolveTags } from '@jobtrack/api/services/tags';
import { toTag } from '@jobtrack/api/db/mappers';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorResult, jsonResult } from '../helpers.js';

export function registerTagTools(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'list_tags',
    { description: 'List every tag in the free-form tag vocabulary.', inputSchema: z.object({}) },
    async () => jsonResult(await listTags(repos)),
  );

  server.registerTool(
    'create_tag',
    {
      description:
        'Create a tag directly. Applications and companies normally create tags implicitly by name when you attach one that does not exist yet.',
      inputSchema: createTagSchema,
    },
    async (input) => {
      const [row] = await resolveTags(repos, [input.name], input.scope);
      search.markStale();
      return row ? jsonResult(toTag(row)) : errorResult('Tag could not be created');
    },
  );
}
