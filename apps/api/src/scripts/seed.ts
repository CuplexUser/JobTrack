/**
 * Seed the database with a realistic job search.
 *
 * Not just filler. The data is arranged so the two features that are hard to demonstrate
 * on an empty database actually have something to find:
 *
 * - **Duplicate detection**: several companies appear more than once, including one with
 *   two spellings ("Spotify" and "Spotify AB") and one where the same role was applied for
 *   twice a year apart.
 * - **Semantic search**: titles deliberately use different vocabulary for the same work
 *   ("Backend Engineer", "Server-Side Developer", "Platform Engineer"), so a query for one
 *   should surface the others.
 */

import { loadConfig } from '../config.js';
import { createRepos } from '../db/repos.js';
import { createApplication } from '../services/applications.service.js';
import { createNote } from '../services/notes.service.js';
import { findCompanyByName, updateCompany } from '../services/companies.service.js';
import type { ApplicationStatus } from '@jobtrack/shared';

interface SeedRow {
  company: string;
  title: string;
  appliedOn: string;
  status: ApplicationStatus;
  location?: string;
  workMode?: 'remote' | 'hybrid' | 'onsite';
  source?: string;
  salary?: [number, number];
  followUpOn?: string;
  tags?: string[];
  notes?: string;
}

const ROWS: SeedRow[] = [
  // ---- 2024 ----
  { company: 'Spotify', title: 'Backend Engineer', appliedOn: '2024-02-12', status: 'rejected', location: 'Stockholm', workMode: 'hybrid', source: 'LinkedIn', salary: [640000, 780000], tags: ['music', 'dream-job'], notes: 'Took the take-home test. Went well but they wanted more Scala than I have.' },
  { company: 'Klarna', title: 'Platform Engineer', appliedOn: '2024-03-04', status: 'rejected', location: 'Stockholm', workMode: 'onsite', source: 'Referral', tags: ['fintech'] },
  { company: 'Ericsson', title: 'Software Developer', appliedOn: '2024-03-19', status: 'ghosted', location: 'Lund', workMode: 'hybrid', source: 'Company site' },
  { company: 'Tink', title: 'Server-Side Developer', appliedOn: '2024-05-02', status: 'interview', location: 'Stockholm', workMode: 'remote', source: 'LinkedIn', salary: [600000, 720000], tags: ['fintech', 'remote-ok'], notes: 'Two rounds done. Liked the team a lot.' },
  { company: 'Volvo Cars', title: 'Embedded Systems Engineer', appliedOn: '2024-06-11', status: 'rejected', location: 'Gothenburg', workMode: 'onsite', source: 'Job board' },
  { company: 'King', title: 'Game Backend Developer', appliedOn: '2024-08-21', status: 'rejected', location: 'Stockholm', workMode: 'hybrid', source: 'LinkedIn', tags: ['games'] },
  { company: 'Northvolt', title: 'Data Engineer', appliedOn: '2024-09-09', status: 'withdrawn', location: 'Västerås', workMode: 'onsite', source: 'Recruiter', notes: 'Withdrew — relocation was not workable.' },
  { company: 'Truecaller', title: 'Backend Engineer', appliedOn: '2024-10-15', status: 'rejected', location: 'Stockholm', workMode: 'hybrid', source: 'Company site' },
  { company: 'Izettle', title: 'API Developer', appliedOn: '2024-11-27', status: 'ghosted', location: 'Stockholm', workMode: 'hybrid', source: 'Job board', tags: ['fintech'] },

  // ---- 2025 ----
  { company: 'Spotify AB', title: 'Senior Backend Engineer', appliedOn: '2025-01-14', status: 'rejected', location: 'Stockholm', workMode: 'hybrid', source: 'LinkedIn', salary: [720000, 880000], tags: ['music', 'dream-job'], notes: 'Second attempt, a year on. Got further this time — final round.' },
  { company: 'Epidemic Sound', title: 'Backend Engineer', appliedOn: '2025-02-03', status: 'rejected', location: 'Stockholm', workMode: 'remote', source: 'LinkedIn', tags: ['music', 'remote-ok'] },
  { company: 'Klarna', title: 'Senior Platform Engineer', appliedOn: '2025-02-20', status: 'ghosted', location: 'Stockholm', workMode: 'hybrid', source: 'Referral', tags: ['fintech'] },
  { company: 'Mentimeter', title: 'Full Stack Developer', appliedOn: '2025-03-11', status: 'interview', location: 'Stockholm', workMode: 'hybrid', source: 'Company site', salary: [620000, 740000], tags: ['saas'] },
  { company: 'Doktor.se', title: 'Backend Developer', appliedOn: '2025-04-01', status: 'rejected', location: 'Stockholm', workMode: 'remote', source: 'Job board', tags: ['health', 'remote-ok'] },
  { company: 'Voi Technology', title: 'Cloud Infrastructure Engineer', appliedOn: '2025-04-22', status: 'rejected', location: 'Stockholm', workMode: 'hybrid', source: 'LinkedIn', tags: ['mobility'] },
  { company: 'Bambora', title: 'Payments Engineer', appliedOn: '2025-05-16', status: 'rejected', location: 'Stockholm', workMode: 'onsite', source: 'Recruiter', tags: ['fintech'] },
  { company: 'H&M Group', title: 'Software Engineer', appliedOn: '2025-06-05', status: 'ghosted', location: 'Stockholm', workMode: 'hybrid', source: 'Company site' },
  { company: 'Tink', title: 'Staff Engineer', appliedOn: '2025-07-18', status: 'rejected', location: 'Stockholm', workMode: 'remote', source: 'Referral', tags: ['fintech', 'remote-ok'], notes: 'Applied again after the earlier interview rounds. Different team.' },
  { company: 'Kry', title: 'Distributed Systems Engineer', appliedOn: '2025-08-26', status: 'rejected', location: 'Stockholm', workMode: 'remote', source: 'LinkedIn', tags: ['health', 'remote-ok'] },
  { company: 'Trustly', title: 'Backend Engineer', appliedOn: '2025-09-15', status: 'interview', location: 'Stockholm', workMode: 'hybrid', source: 'Job board', salary: [660000, 800000], tags: ['fintech'] },
  { company: 'Zettle', title: 'Senior Software Engineer', appliedOn: '2025-10-07', status: 'rejected', location: 'Stockholm', workMode: 'hybrid', source: 'LinkedIn', tags: ['fintech'] },
  { company: 'Netlight', title: 'Consultant Developer', appliedOn: '2025-11-12', status: 'withdrawn', location: 'Stockholm', workMode: 'onsite', source: 'Referral', tags: ['consulting'] },
  { company: 'Polestar', title: 'Backend Engineer', appliedOn: '2025-12-02', status: 'rejected', location: 'Gothenburg', workMode: 'hybrid', source: 'Company site', tags: ['mobility'] },

  // ---- 2026 ----
  { company: 'Spotify', title: 'Staff Backend Engineer', appliedOn: '2026-01-20', status: 'interview', location: 'Stockholm', workMode: 'hybrid', source: 'Referral', salary: [850000, 1000000], followUpOn: '2026-08-20', tags: ['music', 'dream-job'], notes: 'Third time. Referral from someone on the platform team this round.' },
  { company: 'Figma', title: 'Product Engineer', appliedOn: '2026-02-02', status: 'rejected', location: 'Remote (EU)', workMode: 'remote', source: 'LinkedIn', tags: ['design-tools', 'remote-ok'] },
  { company: 'Supabase', title: 'Infrastructure Engineer', appliedOn: '2026-02-17', status: 'screening', location: 'Remote', workMode: 'remote', source: 'Company site', salary: [700000, 900000], followUpOn: '2026-08-15', tags: ['devtools', 'remote-ok'], notes: 'Fully async company. Timezone overlap discussed and fine.' },
  { company: 'Vercel', title: 'Systems Engineer', appliedOn: '2026-03-03', status: 'screening', location: 'Remote', workMode: 'remote', source: 'LinkedIn', salary: [780000, 950000], followUpOn: '2026-08-10', tags: ['devtools', 'remote-ok', 'dream-job'] },
  { company: 'Klarna', title: 'Backend Engineer', appliedOn: '2026-03-12', status: 'rejected', location: 'Stockholm', workMode: 'hybrid', source: 'Job board', tags: ['fintech'], notes: 'Third application here. Should probably stop.' },
  { company: 'Anthropic', title: 'Backend Engineer', appliedOn: '2026-03-25', status: 'applied', location: 'Remote (EU)', workMode: 'remote', source: 'Company site', tags: ['ai', 'remote-ok', 'dream-job'], followUpOn: '2026-08-01' },
  { company: 'Neo4j', title: 'Database Engineer', appliedOn: '2026-04-08', status: 'rejected', location: 'Malmö', workMode: 'hybrid', source: 'LinkedIn', tags: ['devtools'] },
  { company: 'Sinch', title: 'Platform Developer', appliedOn: '2026-04-21', status: 'ghosted', location: 'Stockholm', workMode: 'hybrid', source: 'Recruiter' },
  { company: 'Einride', title: 'Backend Engineer', appliedOn: '2026-05-06', status: 'screening', location: 'Stockholm', workMode: 'hybrid', source: 'LinkedIn', salary: [680000, 820000], tags: ['mobility'], followUpOn: '2026-07-20' },
  { company: 'Detectify', title: 'Security Engineer', appliedOn: '2026-05-19', status: 'rejected', location: 'Stockholm', workMode: 'remote', source: 'Job board', tags: ['security', 'remote-ok'] },
  { company: 'Kognity', title: 'Senior Developer', appliedOn: '2026-06-02', status: 'interview', location: 'Stockholm', workMode: 'remote', source: 'Referral', salary: [640000, 760000], tags: ['edtech', 'remote-ok'], followUpOn: '2026-07-15', notes: 'Technical round scheduled. Small team, lots of ownership.' },
  { company: 'Budbee', title: 'Backend Engineer', appliedOn: '2026-06-16', status: 'applied', location: 'Stockholm', workMode: 'hybrid', source: 'LinkedIn', tags: ['logistics'] },
  { company: 'Modular', title: 'Compiler Engineer', appliedOn: '2026-06-30', status: 'rejected', location: 'Remote', workMode: 'remote', source: 'Company site', tags: ['ai', 'remote-ok'] },
  { company: 'Volvo Cars', title: 'Cloud Platform Engineer', appliedOn: '2026-07-14', status: 'screening', location: 'Gothenburg', workMode: 'hybrid', source: 'Referral', salary: [700000, 850000], tags: ['mobility'], followUpOn: '2026-08-18', notes: 'Second time applying here, different department entirely.' },
  { company: 'Tibber', title: 'Backend Developer', appliedOn: '2026-07-28', status: 'applied', location: 'Remote (Nordics)', workMode: 'remote', source: 'LinkedIn', tags: ['energy', 'remote-ok'], followUpOn: '2026-08-22' },
  { company: 'Anthropic', title: 'Infrastructure Engineer', appliedOn: '2026-08-04', status: 'applied', location: 'Remote (EU)', workMode: 'remote', source: 'Referral', tags: ['ai', 'remote-ok', 'dream-job'], followUpOn: '2026-08-25', notes: 'Second role here. Referral this time.' },
  { company: 'Spotify', title: 'Engineering Manager', appliedOn: '2026-08-11', status: 'applied', location: 'Stockholm', workMode: 'hybrid', source: 'LinkedIn', tags: ['music'], followUpOn: '2026-08-28' },
];

/** Company-level tags and websites, applied after the applications create the companies. */
const COMPANY_DETAILS: Record<string, { website?: string; tags: string[] }> = {
  Spotify: { website: 'https://spotify.com', tags: ['big-tech', 'music', 'applied-often'] },
  Klarna: { website: 'https://klarna.com', tags: ['fintech', 'applied-often'] },
  Anthropic: { website: 'https://anthropic.com', tags: ['ai', 'remote-first'] },
  Tink: { website: 'https://tink.com', tags: ['fintech'] },
  Vercel: { website: 'https://vercel.com', tags: ['devtools', 'remote-first'] },
  Supabase: { website: 'https://supabase.com', tags: ['devtools', 'remote-first'] },
  'Volvo Cars': { website: 'https://volvocars.com', tags: ['mobility', 'applied-often'] },
};

const STANDALONE_NOTES = [
  {
    title: 'Interview prep checklist',
    body: 'System design: rate limiter, URL shortener, feed ranking.\nAlways ask about on-call rotation and how they handle incident review.\nQuestions to ask: what does the first 90 days look like, and who decides priorities?',
  },
  {
    title: 'Salary research 2026',
    body: 'Stockholm senior backend: 700-900k base is the realistic band.\nRemote EU roles trend 10-15% below Stockholm on-site but no commute.\nAlways ask the band before the first technical round.',
  },
];

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

  console.log(`Seeding ${ROWS.length} applications...`);

  for (const row of ROWS) {
    await createApplication(repos, {
      companyName: row.company,
      jobTitle: row.title,
      appliedOn: row.appliedOn,
      status: row.status,
      jobUrl: null,
      location: row.location ?? null,
      workMode: row.workMode ?? 'unspecified',
      sourceName: row.source ?? null,
      salaryMin: row.salary?.[0] ?? null,
      salaryMax: row.salary?.[1] ?? null,
      salaryCurrency: row.salary ? 'SEK' : null,
      followUpOn: row.followUpOn ?? null,
      tags: row.tags ?? [],
      notes: row.notes ?? null,
    });
  }

  for (const [name, details] of Object.entries(COMPANY_DETAILS)) {
    const company = await findCompanyByName(repos, name);
    if (!company) continue;
    await updateCompany(repos, company.id, {
      ...(details.website ? { website: details.website } : {}),
      tags: details.tags,
    });
  }

  for (const note of STANDALONE_NOTES) {
    await createNote(repos, {
      title: note.title,
      body: note.body,
      targetType: 'standalone',
      targetId: null,
      pinned: true,
    });
  }

  const companies = await repos.companies.count();
  const tags = await repos.tags.count();
  const notes = await repos.notes.count();

  console.log(`Done: ${ROWS.length} applications, ${companies} companies, ${tags} tags, ${notes} notes.`);
  console.log('\nThings worth trying:');
  console.log('  · Search "server-side developer" — should surface Backend Engineer roles');
  console.log('  · Start a new application at "Spotify AB" — three prior applications should appear');
  console.log('  · Klarna has been applied to three times, under two different titles');

  await repos.close();
}

await main();
