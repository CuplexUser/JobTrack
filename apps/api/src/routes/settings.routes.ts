/**
 * The user's profile and automation rules, plus a way to see what the auto-ghost rule would do
 * before trusting it to run on its own.
 */

import type { FastifyInstance } from 'fastify';
import { fitWeightsPatchSchema, languagePatchSchema, profilePatchSchema, rulesPatchSchema } from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import {
  getFitWeights,
  getLanguage,
  getProfile,
  getRules,
  updateFitWeights,
  updateLanguage,
  updateProfile,
  updateRules,
} from '../services/settings.service.js';
import { runAutoGhost } from '../services/rules.service.js';

export async function settingsRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.get('/api/profile', async () => getProfile(repos));

  /** A partial update: fields left out keep their stored values. */
  app.put('/api/profile', async (request) => updateProfile(repos, profilePatchSchema.parse(request.body)));

  app.get('/api/rules', async () => getRules(repos));

  app.put('/api/rules', async (request) => updateRules(repos, rulesPatchSchema.parse(request.body)));

  app.get('/api/fit-weights', async () => getFitWeights(repos));

  /** A partial update: fields left out keep their stored values. Reshapes every saved opening's score. */
  app.put('/api/fit-weights', async (request) => updateFitWeights(repos, fitWeightsPatchSchema.parse(request.body)));

  /**
   * The UI language, shared between the web app and the Windows tray app (see
   * `settings.service.ts`'s `getLanguage`/`updateLanguage`). No auth beyond the usual token check
   * middleware already applies to every route: this is a display preference, not a secret.
   */
  app.get('/api/settings/language', async () => getLanguage(repos));

  app.put('/api/settings/language', async (request) => updateLanguage(repos, languagePatchSchema.parse(request.body)));

  /** What the auto-ghost rule would change right now, without changing anything. */
  app.get('/api/rules/auto-ghost', async () => runAutoGhost(repos, { dryRun: true }));

  /** Run the auto-ghost rule now rather than waiting for the next hourly run. */
  app.post('/api/rules/auto-ghost/run', async () => {
    const result = await runAutoGhost(repos);
    if (result.changed > 0) search.markStale();
    return result;
  });
}
