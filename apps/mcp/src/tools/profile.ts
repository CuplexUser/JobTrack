/**
 * The user's profile: what they are looking for, used to rank openings by fit. Rules are left
 * out on purpose. Auto-ghosting changes records on its own, so switching it on stays a choice
 * the user makes in the web app's Settings.
 */

import { z } from 'zod';
import { profilePatchSchema } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import { getProfile, updateProfile } from '@jobtrack/api/services/settings';
import { rankOpenings } from '@jobtrack/api/services/fit';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { jsonResult } from '../helpers.js';
import { openingSummary } from '../views.js';

export function registerProfileTools(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'get_profile',
    {
      description:
        "The user's job search profile: a summary of their experience, target job titles, preferred locations and work modes, salary floor, and keywords to look for or avoid. Empty fields are simply not used when ranking.",
      inputSchema: z.object({}),
    },
    async () => jsonResult(await getProfile(repos)),
  );

  server.registerTool(
    'update_profile',
    {
      description:
        "Change parts of the user's profile. Only the fields given are changed; lists are replaced as a whole, so to add a target title, send the existing titles plus the new one (call get_profile first). Confirm with the user before changing what they are looking for.",
      inputSchema: profilePatchSchema,
    },
    async (patch) => jsonResult(await updateProfile(repos, patch)),
  );

  server.registerTool(
    'rank_openings',
    {
      description:
        "The user's saved openings ranked by fit against their profile, best first, each with a 0 to 100 score and the reasons behind it. Use this to answer 'which of these should I apply to'. Without a profile, hasProfile is false and every fit is null; suggest filling one in.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(20),
        minFit: z.number().int().min(0).max(100).optional(),
      }),
    },
    async ({ limit, minFit }) => {
      const ranked = await rankOpenings(repos, search, { sort: 'fit', ...(minFit !== undefined ? { minFit } : {}) });
      return jsonResult({
        hasProfile: ranked.some((opening) => opening.fit !== null),
        openings: ranked.slice(0, limit).map(openingSummary),
      });
    },
  );
}
