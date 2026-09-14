/**
 * The user's profile: what they are looking for, used to rank saved openings by fit and to
 * score postings before they are saved, so an assistant searching for jobs can tell which
 * ones are worth suggesting. Rules are left
 * out on purpose. Auto-ghosting changes records on its own, so switching it on stays a choice
 * the user makes in the web app's Settings.
 */

import { z } from 'zod';
import { profilePatchSchema, workModeSchema } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import { getProfile, updateProfile } from '@jobtrack/api/services/settings';
import { rankOpenings, scorePostings } from '@jobtrack/api/services/fit';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { jsonResult } from '../helpers.js';
import { fitSummary, openingSummary } from '../views.js';

/** How many postings one score_postings call takes: a page of search results, not a crawl. */
const MAX_POSTINGS = 25;

/** A posting as an assistant found it. Only the title is required; whatever else is known sharpens the score. */
const postingToScoreSchema = z.object({
  companyName: z.string().trim().max(200).optional(),
  jobTitle: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).optional(),
  workMode: workModeSchema.default('unspecified'),
  salaryMin: z.number().int().nonnegative().optional(),
  salaryMax: z.number().int().nonnegative().optional(),
  salaryCurrency: z.string().trim().max(8).optional(),
  description: z.string().max(20000).optional().describe('The posting text, or as much of it as you have'),
});

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

  server.registerTool(
    'score_postings',
    {
      description:
        `Score job postings against the user's profile without saving anything: use it to decide which postings you found are worth suggesting or saving. Send up to ${MAX_POSTINGS} at once, with as much as you know of each (a description makes the score noticeably better when the profile has a summary). Results come back best first, each with its \`index\` in the input, a 0 to 100 score and the reasons. \`summaryCompared\` is false when the posting text was not compared to the profile summary (no summary, or the model is still loading), so the score rests on title, location, work mode, salary and keywords. Without a profile, hasProfile is false and there are no scores. Scores are relative guidance, not a verdict: mention the reasons, and save only what the user picks (capture_posting or create_opening).`,
      inputSchema: z.object({ postings: z.array(postingToScoreSchema).min(1).max(MAX_POSTINGS) }),
    },
    async ({ postings }) => {
      const fits = await scorePostings(
        repos,
        search,
        postings.map((posting) => ({
          companyName: posting.companyName ?? null,
          jobTitle: posting.jobTitle,
          location: posting.location || null,
          workMode: posting.workMode,
          salaryMin: posting.salaryMin ?? null,
          salaryMax: posting.salaryMax ?? null,
          salaryCurrency: posting.salaryCurrency || null,
          notes: posting.description || null,
        })),
      );
      const hasProfile = fits.some((fit) => fit !== null);
      const scored = postings.map((posting, index) => {
        const fit = fits[index];
        return {
          index,
          ...(posting.companyName ? { company: posting.companyName } : {}),
          jobTitle: posting.jobTitle,
          ...(fit ? { fit: fitSummary(fit) } : {}),
        };
      });
      // Stable, so equal scores keep the order they were sent in.
      scored.sort((a, b) => (b.fit?.score ?? -1) - (a.fit?.score ?? -1));
      return jsonResult({
        hasProfile,
        ...(hasProfile ? { summaryCompared: fits.some((fit) => fit?.semanticUsed) } : {}),
        postings: scored,
      });
    },
  );
}
