#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Same default as apps/tray/bin/jobtrack.js, and deliberately the same directory name
// ("jobtrack", not "jobtrack-mcp") — an MCP client pointed at this bin with no extra config
// ends up reading/writing the exact database the globally-installed tray app uses. Set
// JOBTRACK_HOME explicitly (e.g. in the MCP client's `env`) to point this at a different one.
if (!process.env.JOBTRACK_HOME) {
  const base = process.platform === 'win32' && process.env.APPDATA ? process.env.APPDATA : join(homedir(), '.local', 'share');
  process.env.JOBTRACK_HOME = join(base, 'jobtrack');
}

// Ships TypeScript sources rather than a compiled build, same as apps/tray and apps/api — see
// apps/tray/bin/jobtrack.js for why this spawns a child `node` with tsx's own `--require
// --import` flags instead of registering the loader in-process, and why `env` must stay unset
// on spawnSync (true inheritance) rather than being passed through explicitly.
const require = createRequire(import.meta.url);
const preflight = require.resolve('tsx/preflight');
const loader = pathToFileURL(require.resolve('tsx')).href;
const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));

const result = spawnSync(
  process.execPath,
  ['--require', preflight, '--import', loader, entry, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
