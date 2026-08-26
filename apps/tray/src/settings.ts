/**
 * "Open app settings" — the tray's escape hatch to .env, which is the only place connection
 * settings and other secrets live (see apps/api/src/config.ts). Seeded from .env.example on
 * first use so there's always a real file to open, matching `npm install`'s quick-start step.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveAppDataDir } from '@jobtrack/api/config';
import { resolveEnvExample } from './assets.js';
import { openInEditor } from './os.js';

export function openSettingsFile(): void {
  const envPath = resolve(resolveAppDataDir(), '.env');
  const examplePath = resolveEnvExample();

  if (!existsSync(envPath) && examplePath) {
    copyFileSync(examplePath, envPath);
  }

  openInEditor(envPath);
}
