/**
 * Entry point for the `jobtrack` command (see bin/jobtrack.js).
 *
 * Starts the API + web UI as one process (server.ts) and, on Windows, shows a tray icon for
 * opening the UI, toggling autostart, and opening .env (tray.ts). Elsewhere it just runs
 * headless — Ctrl+C to stop — until a native tray for those platforms is worth building.
 *
 * The Windows installer (see `windows/`) is the one other caller: it draws its own native tray
 * and supervises this process, so it passes `--no-tray` and `--home`, reads the JOBTRACK_READY
 * line below off stdout, and asks for a clean stop by writing `quit` to stdin. None of that
 * changes what plain `jobtrack` does.
 */
import { resolve } from 'node:path';
import { startServer } from './server.js';
import { isAutostartEnabled, enableAutostart, disableAutostart } from './autostart.js';
import { openSettingsFile } from './settings.js';
import { openUrl } from './os.js';
import { APP_VERSION } from './version.js';

const argv = process.argv.slice(2);

function flagValue(name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

// Before startServer(), and that ordering is the whole point: `resolveAppDataDir()` in
// apps/api/src/config.ts reads process.env when it's called, and everything under the data
// directory — the database, the model cache, .env itself — hangs off what it returns.
//
// A flag rather than an inherited JOBTRACK_HOME because bin/jobtrack.js documents that handing
// a reconstructed environment to a Node child breaks tsx's loader; a supervisor that never has
// to set an environment variable can't trip over that at all.
const home = flagValue('--home');
if (home) process.env.JOBTRACK_HOME = resolve(home);

const noTray = argv.includes('--no-tray') || process.env.JOBTRACK_NO_TRAY === '1';

const { app, config, repos, search } = await startServer();

const url = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
console.log(`JobTrack v${APP_VERSION} running at ${url} (driver: ${config.driver})`);

// The same facts again, in one parseable line, so a supervisor knows the server is up and on
// which address without scraping prose or guessing at a port it may have only set in .env.
console.log(
  `JOBTRACK_READY ${JSON.stringify({
    url,
    host: config.host,
    port: config.port,
    version: APP_VERSION,
    driver: config.driver,
  })}`,
);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  search.stop();
  await app.close();
  await repos.close();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown());
}

/**
 * Line-oriented commands from a supervising process. Windows has no dependable way to send a
 * running process anything like SIGTERM from outside, so stdin is how the installer's host asks
 * for the orderly shutdown above — closing SQLite properly — before it resorts to killing the
 * job object.
 */
function listenForSupervisorCommands(): void {
  process.stdin.setEncoding('utf8');
  let buffered = '';
  process.stdin.on('data', (chunk: string) => {
    buffered += chunk;
    let newline: number;
    while ((newline = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line === 'quit') void shutdown();
    }
  });
  // The supervisor is gone; there is nobody left to serve.
  process.stdin.on('end', () => void shutdown());
}

if (noTray) {
  listenForSupervisorCommands();
} else if (process.platform === 'win32') {
  // Imported here rather than at the top so that `systray` — 35 MB of Go tray binaries for
  // three platforms — is only ever loaded when a tray is actually going to be drawn. That is
  // what lets the Windows installer's payload delete the package outright: its native host
  // draws the tray itself and always passes --no-tray.
  const { createTray } = await import('./tray.js');
  const tray = createTray({
    autostartEnabled: isAutostartEnabled(),
    onOpen: () => openUrl(url),
    onToggleAutostart: (enabled) => (enabled ? enableAutostart() : disableAutostart()),
    onOpenSettings: () => openSettingsFile(),
    onQuit: () => void shutdown(),
  });
  process.once('exit', () => tray.kill(false));
} else {
  console.log('[tray] a system tray icon is only implemented for Windows today; running headless. Press Ctrl+C to stop.');
}
