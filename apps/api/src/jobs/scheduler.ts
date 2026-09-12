/**
 * Work the server does on its own, on a timer.
 *
 * Started by the long-running entry points (`src/index.ts` and the tray's server), never by
 * the MCP server, the tests or the demo build, so there is one place a rule runs from however
 * many processes are open. Every job here is idempotent, which is what lets the loop stay
 * this simple: no record of the last run, no catching up on missed ones after a restart,
 * just "do whatever is due now" once an hour.
 */

import type { Deps } from '../deps.js';
import { runAutoGhost } from '../services/rules.service.js';

export interface BackgroundJobs {
  /** Run every job now, as the timer would. Resolves when they are done. */
  runNow(): Promise<void>;
  stop(): void;
}

export interface SchedulerOptions {
  log: (message: string, error?: unknown) => void;
  /** Time between runs. An hour: every job here works in whole days. */
  intervalMs?: number;
  /** Time before the first run, so start-up is not slowed by it. */
  initialDelayMs?: number;
}

export function startBackgroundJobs(deps: Deps, options: SchedulerOptions): BackgroundJobs {
  const intervalMs = options.intervalMs ?? 60 * 60 * 1000;
  let running: Promise<void> | null = null;

  async function runJobs(): Promise<void> {
    try {
      const result = await runAutoGhost(deps.repos);
      if (result.changed > 0) {
        deps.search.markStale();
        options.log(
          `auto-ghost marked ${result.changed} application${result.changed === 1 ? '' : 's'} ghosted after ${result.afterDays} silent days`,
        );
      }
    } catch (error) {
      options.log('auto-ghost failed', error);
    }
  }

  // Never two runs at once: a slow run is joined, not doubled.
  const runNow = (): Promise<void> => {
    running ??= runJobs().finally(() => {
      running = null;
    });
    return running;
  };

  const first = setTimeout(() => void runNow(), options.initialDelayMs ?? 60_000);
  const every = setInterval(() => void runNow(), intervalMs);
  // Timers must never be what keeps the process alive.
  first.unref?.();
  every.unref?.();

  return {
    runNow,
    stop() {
      clearTimeout(first);
      clearInterval(every);
    },
  };
}
