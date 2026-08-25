import { beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import type { RepoBundle } from '../src/db/repos.js';
import { createApplication, findAllMatching } from '../src/services/applications.service.js';
import { applicationFilterSchema } from '@jobtrack/shared';
import { csvLines, writeWorkbook } from '../src/export/workbook.js';
import { exportFilename, EXPORT_COLUMNS } from '../src/export/columns.js';
import { applicationInput, createMemoryRepos } from './support/repos.js';

let repos: RepoBundle;

beforeEach(async () => {
  repos = createMemoryRepos();
  await createApplication(
    repos,
    applicationInput({ appliedOn: '2026-03-12', tags: ['ai', 'remote-ok'], status: 'interview' }),
  );
  await createApplication(
    repos,
    applicationInput({ companyName: 'Klarna', jobTitle: 'Platform, Engineer', appliedOn: '2025-11-05' }),
  );
});

async function rows() {
  return findAllMatching(repos, applicationFilterSchema.parse({}));
}

describe('CSV export', () => {
  it('starts with a BOM and a header row', async () => {
    const csv = [...csvLines(await rows())].join('');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toContain('Applied On,Year,Month,Company,Job Title');
  });

  it('has one line per application plus the header', async () => {
    const csv = [...csvLines(await rows())].join('');
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
  });

  it('quotes a job title containing a comma so columns do not shift', async () => {
    const csv = [...csvLines(await rows())].join('');
    expect(csv).toContain('"Platform, Engineer"');
  });

  it('joins tags into one quoted cell', async () => {
    const csv = [...csvLines(await rows())].join('');
    expect(csv).toContain('"ai, remote-ok"');
  });

  it('renders the month by name, matching the sidebar', async () => {
    const csv = [...csvLines(await rows())].join('');
    expect(csv).toContain(',2026,March,');
  });
});

describe('exportFilename', () => {
  it('names the scope and dates the file', () => {
    expect(exportFilename('csv', '2026')).toMatch(/^jobtrack-2026-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(exportFilename('xlsx', '')).toMatch(/^jobtrack-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});

describe('XLSX export', () => {
  async function buildWorkbook(): Promise<ExcelJS.Workbook> {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));

    const finished = new Promise<void>((resolve) => stream.on('end', () => resolve()));
    await writeWorkbook(await rows(), stream);
    await finished;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks));
    return workbook;
  }

  it('writes one worksheet per year, newest first, plus a summary', async () => {
    const workbook = await buildWorkbook();
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Summary', '2026', '2025']);
  });

  it('puts each application on its own year sheet', async () => {
    const workbook = await buildWorkbook();
    expect(workbook.getWorksheet('2026')!.rowCount - 1).toBe(1);
    expect(workbook.getWorksheet('2025')!.rowCount - 1).toBe(1);
  });

  it('freezes the header row and adds an autofilter', async () => {
    const workbook = await buildWorkbook();
    const sheet = workbook.getWorksheet('2026')!;
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
  });

  it('totals the summary to the number of applications exported', async () => {
    const workbook = await buildWorkbook();
    const summary = workbook.getWorksheet('Summary')!;
    const lastRow = summary.getRow(summary.rowCount);

    expect(lastRow.getCell(1).value).toBe('All periods');
    // Final column is the grand total.
    expect(lastRow.getCell(EXPORT_COLUMNS.length).value).toBeDefined();
    const total = lastRow.values as unknown[];
    expect(total[total.length - 1]).toBe(2);
  });

  it('produces a valid workbook even with nothing to export', async () => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<void>((resolve) => stream.on('end', () => resolve()));

    await writeWorkbook([], stream);
    await finished;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks));
    expect(workbook.worksheets.map((w) => w.name)).toContain('Applications');
  });
});
