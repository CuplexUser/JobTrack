/**
 * Runs the plan that scripts/check-publishable.mjs wrote: `npm publish` for each package it
 * marked `publish`, in the order it listed them, skipping the rest.
 *
 * Split from the check on purpose — deciding what to publish is worth running on its own
 * (locally, or as a gate that fails the build), and keeping the irreversible half separate
 * means a dry run exercises the same code path a real publish takes.
 *
 * Usage:
 *   node scripts/publish-planned.mjs <plan.json> [--dry-run]
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const planPath = args.find((arg) => !arg.startsWith('--'));
if (!planPath) {
  console.error('Usage: node scripts/publish-planned.mjs <plan.json> [--dry-run]');
  process.exit(2);
}

const plan = JSON.parse(readFileSync(resolve(repoRoot, planPath), 'utf8'));
const summary = [];

for (const { dir, name, version, status } of plan) {
  if (status !== 'publish') {
    console.log(`== ${name}@${version} — already on the registry, unchanged; skipping`);
    summary.push(`- \`${name}@${version}\` — skipped (unchanged)`);
    continue;
  }

  console.log(`== ${name}@${version}`);
  // --provenance is redundant under trusted publishing (npm attests automatically) but kept
  // explicit: it states the intent, and it still applies if this ever falls back to a token.
  // Dropped for a dry run, where there's no upload to attest. Through a shell as one string,
  // so npm.cmd resolves on Windows too.
  const command = dryRun
    ? 'npm publish --access public --dry-run'
    : 'npm publish --access public --provenance';
  const result = spawnSync(command, { cwd: resolve(repoRoot, dir), shell: true, stdio: 'inherit' });

  if (result.status !== 0) {
    // Stop rather than continue: the next package may depend on this one.
    console.error(`\n${name}@${version} failed to publish — stopping before its dependents.`);
    summary.push(`- \`${name}@${version}\` — **failed**`);
    writeSummary();
    process.exit(1);
  }
  summary.push(`- \`${name}@${version}\` — ${dryRun ? 'dry run (not published)' : 'published with provenance'}`);
}

writeSummary();

function writeSummary() {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const heading = dryRun ? '### Publish plan (dry run)' : '### Published';
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${heading}\n\n${summary.join('\n')}\n`);
}
