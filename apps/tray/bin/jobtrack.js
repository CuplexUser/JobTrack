#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Only the installed CLI needs a real per-user data directory for the database, model cache,
// and .env — `apps/api/src/config.ts` otherwise defaults to the monorepo's own repo root,
// which is exactly right for `npm run tray`/`npm run dev` (run straight off src/ via tsx,
// never through this file) and exactly wrong once this is running out of node_modules.
if (!process.env.JOBTRACK_HOME) {
  const base = process.platform === 'win32' && process.env.APPDATA ? process.env.APPDATA : join(homedir(), '.local', 'share');
  process.env.JOBTRACK_HOME = join(base, 'jobtrack');
}

// The published package ships TypeScript sources rather than a compiled build (matching
// apps/api and apps/mcp, which also run straight off `src/` via tsx). Loading tsx's ESM hook
// in-process — via `node:module`'s `register()`, or tsx's own `tsx/esm/api` register (both
// route through the same internal loader) — throws "tsx must be loaded with --import instead
// of --loader" on current tsx/Node: that loader's `initialize` hook runs in a worker thread and
// never receives its options data that way. So this spawns a child `node` with the exact
// `--require <preflight> --import <loader>` flags the tsx CLI itself uses, resolved via tsx's
// public `tsx`/`tsx/preflight` export paths rather than hardcoded internal file names.
//
// One easy-to-miss gotcha reproducing that: pass `env` to spawnSync at all (even a literal
// `process.env`) and the *same* "must be loaded with --import" error comes back — something
// about handing Node a reconstructed environment object, rather than truly inheriting via
// `stdio`, breaks whatever the loader's worker thread needs. Leaving `env` unset here (true
// inheritance) is required, not a style choice.
const require = createRequire(import.meta.url);
const preflight = require.resolve('tsx/preflight');
const loader = pathToFileURL(require.resolve('tsx')).href;
const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

const result = spawnSync(
  process.execPath,
  ['--require', preflight, '--import', loader, cliEntry, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
