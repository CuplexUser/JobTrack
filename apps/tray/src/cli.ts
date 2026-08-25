/**
 * Entry point for the `jobtrack` command (see bin/jobtrack.js).
 *
 * Starts the API + web UI as one process (server.ts) and, on Windows, shows a tray icon for
 * opening the UI, toggling autostart, and opening .env (tray.ts). Elsewhere it just runs
 * headless — Ctrl+C to stop — until a native tray for those platforms is worth building.
 */
import { startServer } from './server.js';
import { createTray } from './tray.js';
import { isAutostartEnabled, enableAutostart, disableAutostart } from './autostart.js';
import { openSettingsFile } from './settings.js';
import { openUrl } from './os.js';

const { app, config, repos, search } = await startServer();

const url = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
console.log(`JobTrack running at ${url} (driver: ${config.driver})`);

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

if (process.platform === 'win32') {
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
