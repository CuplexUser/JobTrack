/** Dashboard summary — mirrors `dashboard.routes.ts`. */

import { z } from 'zod';
import type { Deps } from '@jobtrack/api/deps';
import { getDashboard } from '@jobtrack/api/services/dashboard';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { jsonResult } from '../helpers.js';

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
}
