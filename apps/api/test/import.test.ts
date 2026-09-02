import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoBundle } from '../src/db/repos.js';
import type { SearchIndex } from '../src/search/index.js';
import { createApplication, findAllMatching } from '../src/services/applications.service.js';
import { commitImport, parseImportFile, previewImport } from '../src/services/import.service.js';
import { csvLines, buildWorkbook } from '../src/export/workbook.js';
import { withNotes } from '../src/export/rows.js';
import { applicationFilterSchema } from '@jobtrack/shared';
import { applicationInput, createMemoryRepos, createTestSearch } from './support/repos.js';

let repos: RepoBundle;
let search: SearchIndex;

beforeEach(async () => {
  repos = createMemoryRepos();
  search = createTestSearch(repos);
  await createApplication(
    repos,
    applicationInput({
      jobTitle: 'Backend Engineer',
      appliedOn: '2026-03-12',
      status: 'interview',
      notes: 'Take-home went well.',
    }),
  );
});

async function exportedCsv(): Promise<string> {
  const rows = await withNotes(repos, await findAllMatching(repos, applicationFilterSchema.parse({})));
  return [...csvLines(rows)].join('');
}

describe('parseImportFile (csv)', () => {
  it('parses the file Export itself produces', async () => {
    const { rows, errors } = await parseImportFile(Buffer.from(await exportedCsv(), 'utf8'), 'csv');
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      expect.objectContaining({
        position: 'Backend Engineer',
        company: 'Spotify',
        location: 'Stockholm',
        date: '2026-03-12',
        status: 'Interview',
        notes: 'Take-home went well.',
      }),
    ]);
  });

  it('reports a missing required column as a file-level error', async () => {
    const { rows, errors } = await parseImportFile(
      Buffer.from('Position,Company,Date\r\nBackend Engineer,Spotify,2026-03-12\r\n', 'utf8'),
      'csv',
    );
    expect(rows).toEqual([]);
    expect(errors[0]).toContain('missing');
  });

  it('accepts a file that predates the Location column', async () => {
    const { rows, errors } = await parseImportFile(
      Buffer.from(
        'Position,Company,Date,Status,Notes\r\nPlatform Engineer,Klarna,2026-01-10,Applied,\r\n',
        'utf8',
      ),
      'csv',
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ position: 'Platform Engineer', location: '' });
  });

  it('drops a blank line rather than turning it into a row', async () => {
    const { rows } = await parseImportFile(
      Buffer.from(
        'Position,Company,Date,Status,Notes\r\nBackend Engineer,Spotify,2026-03-12,Applied,\r\n\r\n',
        'utf8',
      ),
      'csv',
    );
    expect(rows).toHaveLength(1);
  });
});

describe('parseImportFile (xlsx)', () => {
  it('parses a workbook Export itself produces', async () => {
    const rows = await withNotes(repos, await findAllMatching(repos, applicationFilterSchema.parse({})));
    const buffer = await buildWorkbook(rows);

    const { rows: parsed, errors } = await parseImportFile(buffer, 'xlsx');
    expect(errors).toEqual([]);
    expect(parsed).toEqual([
      expect.objectContaining({
        position: 'Backend Engineer',
        company: 'Spotify',
        date: '2026-03-12',
        status: 'Interview',
      }),
    ]);
  });
});

describe('previewImport', () => {
  it('classifies a row identical to an existing application as a duplicate', async () => {
    const { rows } = await parseImportFile(Buffer.from(await exportedCsv(), 'utf8'), 'csv');
    const [preview] = await previewImport(repos, search, rows);
    expect(preview?.verdict).toBe('duplicate');
  });

  it('classifies a genuinely new row as new', async () => {
    const csv =
      'Position,Company,Date,Status,Notes\r\nPlatform Engineer,Klarna,2026-01-10,Applied,\r\n';
    const { rows } = await parseImportFile(Buffer.from(csv, 'utf8'), 'csv');
    const [preview] = await previewImport(repos, search, rows);
    expect(preview?.verdict).toBe('new');
    expect(preview?.data).toMatchObject({ companyName: 'Klarna', jobTitle: 'Platform Engineer' });
  });

  it('carries the location through to the created application', async () => {
    const csv =
      'Position,Company,Location,Date,Status,Notes\r\n' +
      'Platform Engineer,Klarna,Malmo,2026-01-10,Applied,\r\n';
    const { rows } = await parseImportFile(Buffer.from(csv, 'utf8'), 'csv');
    const [preview] = await previewImport(repos, search, rows);
    expect(preview?.data).toMatchObject({ location: 'Malmo' });
  });

  it('classifies a second identical row within the same file as a duplicate too', async () => {
    const csv =
      'Position,Company,Date,Status,Notes\r\n' +
      'Platform Engineer,Klarna,2026-01-10,Applied,\r\n' +
      'Platform Engineer,Klarna,2026-01-10,Applied,\r\n';
    const { rows } = await parseImportFile(Buffer.from(csv, 'utf8'), 'csv');
    const preview = await previewImport(repos, search, rows);
    expect(preview.map((r) => r.verdict)).toEqual(['new', 'duplicate']);
  });

  it('reports an unparseable date as an error without touching the database', async () => {
    const csv = 'Position,Company,Date,Status,Notes\r\nPlatform Engineer,Klarna,not-a-date,Applied,\r\n';
    const { rows } = await parseImportFile(Buffer.from(csv, 'utf8'), 'csv');
    const [preview] = await previewImport(repos, search, rows);
    expect(preview?.verdict).toBe('error');
    expect(preview?.errors[0]).toContain('not-a-date');
  });

  it('reports an unrecognized status as an error', async () => {
    const csv = 'Position,Company,Date,Status,Notes\r\nPlatform Engineer,Klarna,2026-01-10,Not A Status,\r\n';
    const { rows } = await parseImportFile(Buffer.from(csv, 'utf8'), 'csv');
    const [preview] = await previewImport(repos, search, rows);
    expect(preview?.verdict).toBe('error');
  });
});

describe('commitImport', () => {
  it('creates only the new rows and skips the exact duplicate', async () => {
    const csv =
      'Position,Company,Date,Status,Notes\r\n' +
      'Backend Engineer,Spotify,2026-03-12,Interview,Take-home went well.\r\n' + // exact duplicate
      'Platform Engineer,Klarna,2026-01-10,Applied,Referral from a friend.\r\n'; // new
    const { rows } = await parseImportFile(Buffer.from(csv, 'utf8'), 'csv');

    const result = await commitImport(repos, search, rows);
    expect(result).toMatchObject({ created: 1, skipped: 1, failed: 0 });

    const all = await findAllMatching(repos, applicationFilterSchema.parse({}));
    expect(all).toHaveLength(2); // the original plus the one new import
    expect(all.some((a) => a.company.name === 'Klarna' && a.jobTitle === 'Platform Engineer')).toBe(true);
  });

  it('does not abort the batch when one row fails to parse', async () => {
    const csv =
      'Position,Company,Date,Status,Notes\r\n' +
      'Platform Engineer,Klarna,not-a-date,Applied,\r\n' +
      'Data Engineer,Klarna,2026-02-01,Applied,\r\n';
    const { rows } = await parseImportFile(Buffer.from(csv, 'utf8'), 'csv');

    const result = await commitImport(repos, search, rows);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.message).toContain('not-a-date');
  });
});
