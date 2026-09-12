/**
 * Openings ranked by how well they fit the user's profile.
 *
 * The scoring itself is the pure `scoreFit` in `@jobtrack/shared`; this module fetches the
 * profile and the openings, asks the search index how close each posting reads to the
 * profile summary, and sorts. Without a profile every opening's fit is null and the list
 * keeps its usual newest-first order.
 */

import {
  hasFitCriteria,
  scoreFit,
  type OpeningFilter,
  type RankedOpening,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import type { SearchIndex } from '../search/index.js';
import { listOpenings } from './openings.service.js';
import { getProfile } from './settings.service.js';

export async function rankOpenings(
  repos: Repos,
  search: Pick<SearchIndex, 'similarityBetween'> | null,
  filter: Partial<OpeningFilter> = {},
): Promise<RankedOpening[]> {
  const [openings, profile] = await Promise.all([listOpenings(repos, filter), getProfile(repos)]);
  if (!hasFitCriteria(profile)) return openings.map((opening) => ({ ...opening, fit: null }));

  // What a posting says about itself: the title carries the most, the captured description
  // (kept in `notes`) the rest.
  const similarities =
    profile.summary && search && openings.length > 0
      ? await search.similarityBetween(
          profile.summary,
          openings.map((opening) => [opening.jobTitle, opening.company.name, opening.notes].filter(Boolean).join('. ')),
        )
      : null;

  let ranked: RankedOpening[] = openings.map((opening, index) => ({
    ...opening,
    fit: scoreFit(profile, opening, similarities?.[index] ?? null),
  }));

  if (filter.minFit !== undefined) {
    ranked = ranked.filter((opening) => (opening.fit?.score ?? 0) >= filter.minFit!);
  }
  if (filter.sort === 'fit') {
    // Stable, so openings with the same score keep their newest-first order.
    ranked.sort((a, b) => (b.fit?.score ?? -1) - (a.fit?.score ?? -1));
  }
  return ranked;
}
