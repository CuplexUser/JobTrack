/**
 * Autostart with Windows, via the per-user Registry Run key — no admin rights needed, and it
 * survives reinstalls since it's keyed off HKCU, not the app's install location.
 *
 * The registered command always points at this package's `bin/jobtrack.js`, resolved relative
 * to this module rather than to however the current process happened to be launched (tsx watch
 * during development must never end up as the autostart target).
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, '../bin/jobtrack.js');

const RUN_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`;
const VALUE_NAME = 'JobTrack';

function assertWindows(): void {
  if (process.platform !== 'win32') {
    throw new Error('Autostart is only supported on Windows.');
  }
}

export function isAutostartEnabled(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    execFileSync('reg', ['query', RUN_KEY, '/v', VALUE_NAME], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function enableAutostart(): void {
  assertWindows();
  const command = `"${process.execPath}" "${binPath}"`;
  execFileSync('reg', ['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', command, '/f'], {
    stdio: 'ignore',
  });
}

export function disableAutostart(): void {
  assertWindows();
  try {
    execFileSync('reg', ['delete', RUN_KEY, '/v', VALUE_NAME, '/f'], { stdio: 'ignore' });
  } catch {
    // Already absent — nothing to do.
  }
}
