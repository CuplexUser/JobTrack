/**
 * The user's profile and automation rules, plus a way to see what the auto-ghost rule would do
 * before trusting it to run on its own.
 */

import type { FastifyInstance } from 'fastify';
import { profilePatchSchema, rulesPatchSchema } from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { getProfile, getRules, updateProfile, updateRules } from '../services/settings.service.js';
import { runAutoGhost } from '../services/rules.service.js';

export async function settingsRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.get('/api/profile', async () => getProfile(repos));

  /** A partial update: fields left out keep their stored values. */
  app.put('/api/profile', async (request) => updateProfile(repos, profilePatchSchema.parse(request.body)));

  app.get('/api/rules', async () => getRules(repos));

  app.put('/api/rules', async (request) => updateRules(repos, rulesPatchSchema.parse(request.body)));

  /** What the auto-ghost rule would change right now, without changing anything. */
  app.get('/api/rules/auto-ghost', async () => runAutoGhost(repos, { dryRun: true }));

  /** Run the auto-ghost rule now rather than waiting for the next hourly run. */
  app.post('/api/rules/auto-ghost/run', async () => {
    const result = await runAutoGhost(repos);
    if (result.changed > 0) search.markStale();
    return result;
  });
}
