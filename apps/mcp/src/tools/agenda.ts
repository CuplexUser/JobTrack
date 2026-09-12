/** The agenda: what is waiting on the user today. Mirrors `GET /api/agenda`. */

import { z } from 'zod';
import type { Deps } from '@jobtrack/api/deps';
import { OPENING_IDLE_DAYS, getAgenda } from '@jobtrack/api/services/agenda';
import { STALE_AFTER_DAYS } from '@jobtrack/api/services/dashboard';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { jsonResult } from '../helpers.js';
import { applicationSummary, openingSummary } from '../views.js';

export function registerAgendaTool(server: McpServer, deps: Deps): void {
  server.registerTool(
    'get_agenda',
    {
      description: `What needs the user's attention today, in three lists: followUps (live applications whose follow-up date has arrived), goneQuiet (live applications with no follow-up date that nothing has happened to in ${STALE_AFTER_DAYS}+ days, with silentDays), and idleOpenings (openings saved ${OPENING_IDLE_DAYS}+ days ago and still neither converted nor archived, with idleDays). Start a review or a "what should I do" question here.`,
      inputSchema: z.object({}),
    },
    async () => {
      const agenda = await getAgenda(deps.repos);
      return jsonResult({
        today: agenda.today,
        followUps: agenda.followUps.map(applicationSummary),
        goneQuiet: agenda.goneQuiet.map((app) => ({
          ...applicationSummary(app),
          silentSince: app.silentSince,
          silentDays: app.silentDays,
        })),
        idleOpenings: agenda.idleOpenings.map((opening) => ({
          ...openingSummary(opening),
          idleDays: opening.idleDays,
        })),
      });
    },
  );
}
