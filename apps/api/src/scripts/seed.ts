/**
 * CLI entry point for local setup: `npm run seed`. The actual demo dataset lives in
 * `backup/seed.ts`, shared with the Settings page's "Seed with demo data" button.
 */

import { loadConfig } from '../config.js';
import { createRepos } from '../db/repos.js';
import { seedDemoData } from '../backup/seed.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const repos = await createRepos(config);

  const existing = await repos.applications.count();
  if (existing > 0 && process.argv[2] !== '--force') {
    console.log(
      `Database already holds ${existing} applications. Re-run with --force to add the seed data anyway.`,
    );
    await repos.close();
    return;
  }

  console.log('Seeding demo data...');
  const result = await seedDemoData(repos);

  console.log(
    `Done: ${result.applications} applications, ${result.companies} companies, ${result.tags} tags, ${result.notes} notes.`,
  );
  console.log('\nThings worth trying:');
  console.log('  · Search "server-side developer" — should surface Backend Engineer roles');
  console.log('  · Start a new application at "Spotify AB" — three prior applications should appear');
  console.log('  · Klarna has been applied to three times, under two different titles');

  await repos.close();
}

await main();
