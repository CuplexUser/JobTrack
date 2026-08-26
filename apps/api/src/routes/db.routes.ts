/**
 * Which database targets `.env` defines, and switching between them.
 *
 * The switch is restart-based, not a live hot-swap: every other route reads `repos`/`search`
 * once, at server startup (see `deps.ts`), so the only safe way to change what they point at
 * is to change it before they're built. `POST /api/db/switch` writes the new choice to a
 * pointer file (see `db/targets.ts`) and exits the process — `config.ts` reads that pointer
 * the next time it boots and connects to the new target instead.
 *
 * That means something has to bring the process back up: `npm run dev`'s `tsx watch` does
 * **not** restart on a self-exit (only on a file change), so a dev server needs restarting by
 * hand after a switch; a production deployment needs a supervisor (pm2, systemd, Docker
 * `restart: unless-stopped`, …) for this to be seamless. See the README's "Switching
 * databases" section.
 */

import type { FastifyInstance } from 'fastify';
import { switchDbTargetSchema } from '@jobtrack/shared';
import type { Config } from '../config.js';
import { createRepos } from '../db/create-repos.js';
import { loadDbTargets, writeActiveTargetName } from '../db/targets.js';
import type { Deps } from '../deps.js';
import { badRequest } from '../lib/errors.js';

export async function dbRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/api/db/targets', async () => {
    return { targets: deps.config.dbTargets, active: deps.config.activeDbTarget };
  });

  app.post('/api/db/switch', async (request) => {
    const { target: targetName } = switchDbTargetSchema.parse(request.body);

    if (targetName === deps.config.activeDbTarget) {
      return { ok: true as const, restarting: false as const };
    }

    // Re-read `.env` directly rather than `deps.config.dbTargets`, which is sanitized for the
    // UI (name + driver only) — switching needs the connection details behind the name.
    const targets = loadDbTargets(process.env);
    const target = targets.find((t) => t.name === targetName);
    if (!target) throw badRequest(`No target named "${targetName}" is configured`);

    // Prove the target is reachable before committing to it, so a typo'd DATABASE_URL fails
    // loudly here instead of leaving the app unable to come back up after it exits below.
    const probeConfig: Config = {
      ...deps.config,
      driver: target.driver,
      databaseFile: target.databaseFile ?? deps.config.databaseFile,
      databaseUrl: target.databaseUrl,
    };
    const probe = await createRepos(probeConfig).catch((error) => {
      throw badRequest(
        `Could not connect to "${targetName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    await probe.close();

    writeActiveTargetName(deps.config.dataDir, targetName);

    // Let the response flush before the process exits.
    setTimeout(() => process.exit(0), 100).unref();

    return { ok: true as const, restarting: true as const };
  });
}
