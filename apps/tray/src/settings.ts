/**
 * "Open app settings" — the tray's escape hatch to .env, which is the only place connection
 * settings and other secrets live (see apps/api/src/config.ts). Seeded from .env.example on
 * first use so there's always a real file to open, matching `npm install`'s quick-start step.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '@jobtrack/api/config';
import { openInEditor } from './os.js';

export function openSettingsFile(): void {
  const envPath = resolve(repoRoot, '.env');
  const examplePath = resolve(repoRoot, '.env.example');

  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
  }

  openInEditor(envPath);
}
