import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { RepoBundle } from '../src/db/repos.js';
import { createApplication, findAllMatching } from '../src/services/applications.service.js';
import { createNote } from '../src/services/notes.service.js';
import { applicationFilterSchema } from '@jobtrack/shared';
import { buildWorkbook, csvLines } from '../src/export/workbook.js';
import { exportFilename, EXPORT_COLUMNS } from '../src/export/columns.js';
import { withNotes, type ExportRow } from '../src/export/rows.js';
import { applicationInput, createMemoryRepos } from './support/repos.js';
import { entriesMissingMetadata, readZipCentralDirectory } from './support/zip.js';

let repos: RepoBundle;

beforeEach(async () => {
  repos = createMemoryRepos();
  await createApplication(
    repos,
    applicationInput({
      jobTitle: 'Backend Engineer',
      appliedOn: '2026-03-12',
      status: 'interview',
      notes: 'Take-home went well.',
    }),
  );
  await createApplication(
    repos,
    applicationInput({
      companyName: 'Klarna',
      jobTitle: 'Platform, Engineer',
      appliedOn: '2025-11-05',
      status: 'rejected',
    }),
  );
});

async function rows(): Promise<ExportRow[]> {
  return withNotes(repos, await findAllMatching(repos, applicationFilterSchema.parse({})));
}

describe('export columns', () => {
  it('is exactly the list the export is meant to be', () => {
    expect(EXPORT_COLUMNS.map((c) => c.header)).toEqual([
      'Position',
      'Company',
      'Date',
      'Status',
      'Notes',
    ]);
  });
});

describe('withNotes', () => {
  it('attaches the note text, not a count', async () => {
    const exported = await rows();
    const backend = exported.find((r) => r.jobTitle === 'Backend Engineer')!;
    expect(backend.notesText).toBe('Take-home went well.');
  });

  it('leaves the notes cell empty when there are none', async () => {
    const exported = await rows();
    const klarna = exported.find((r) => r.company.name === 'Klarna')!;
    expect(klarna.notesText).toBe('');
  });

  it('joins several notes into one cell', async () => {
    const target = (await repos.applications.findOne({ where: { jobTitle: 'Backend Engineer' } }))!;
    await createNote(repos, {
      title: 'Second thoughts',
      body: 'Salary band was lower than advertised.',
      targetType: 'application',
      targetId: target.id,
      pinned: false,
    });

    const exported = await rows();
    const backend = exported.find((r) => r.jobTitle === 'Backend Engineer')!;
    expect(backend.notesText).toContain('Take-home went well.');
    expect(backend.notesText).toContain('Salary band was lower');
    expect(backend.notesText).toContain('\n\n');
  });

  it('handles an empty export without touching the database', async () => {
    // Guards the same rule the hydrate layer follows: cost must not grow with the export.
    const exported = await withNotes(repos, []);
    expect(exported).toEqual([]);
  });
});

describe('CSV export', () => {
  it('starts with a BOM and the five headers', async () => {
    const csv = [...csvLines(await rows())].join('');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toBe('﻿Position,Company,Date,Status,Notes');
  });

  it('has one line per application plus the header', async () => {
    const csv = [...csvLines(await rows())].join('');
    // The notes cell has no newline in this fixture, so line count is meaningful here.
    expect(csv.trimEnd().split('\r\n')).toHaveLength(3);
  });

  it('writes the status as a readable label, not the stored value', async () => {
    const csv = [...csvLines(await rows())].join('');
    expect(csv).toContain(',Interview,');
    expect(csv).toContain(',Rejected,');
    expect(csv).not.toContain(',interview,');
  });

  it('quotes a position containing a comma so columns do not shift', async () => {
    const csv = [...csvLines(await rows())].join('');
    expect(csv).toContain('"Platform, Engineer"');
  });

  it('quotes multi-paragraph notes so they stay in one cell', async () => {
    const target = (await repos.applications.findOne({ where: { jobTitle: 'Backend Engineer' } }))!;
    await createNote(repos, {
      title: 'More',
      body: 'Second note.',
      targetType: 'application',
      targetId: target.id,
      pinned: false,
    });

    const csv = [...csvLines(await rows())].join('');
    expect(csv).toContain('"Take-home went well.\n\nSecond note."');
  });

  it('no longer carries the analytical columns', async () => {
    const header = [...csvLines(await rows())].join('').split('\r\n')[0]!;
    for (const dropped of ['Year', 'Month', 'Work Mode', 'Salary Min', 'Source', 'Job URL']) {
      expect(header).not.toContain(dropped);
    }
  });
});

describe('exportFilename', () => {
  it('names the scope and dates the file', () => {
    expect(exportFilename('csv', '2026')).toMatch(/^jobtrack-2026-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(exportFilename('xlsx', '')).toMatch(/^jobtrack-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});

describe('XLSX export', () => {
  /**
   * Read the workbook back through a *fresh* ExcelJS.Workbook rather than asserting on the
   * object that wrote it, so the assertions cover what actually lands in the file.
   */
  async function read(data?: ExportRow[]): Promise<ExcelJS.Workbook> {
    const buffer = await buildWorkbook(data ?? (await rows()));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
  }

  it('records a real crc and size for every entry in the central directory', async () => {
    // The regression this pins: the streaming writer left crc and uncompressed size at
    // zero for several entries, which strict readers treat as empty files. exceljs itself
    // read those archives fine, so only a check at this level catches it.
    const buffer = await buildWorkbook(await rows());
    expect(entriesMissingMetadata(buffer)).toEqual([]);
  });

  it('is a well-formed archive containing the expected parts', async () => {
    const buffer = await buildWorkbook(await rows());
    const names = readZipCentralDirectory(buffer).map((e) => e.name);

    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('xl/workbook.xml');
    expect(names.some((n) => n.startsWith('xl/worksheets/sheet'))).toBe(true);
  });

  it('has no summary or statistics sheet', async () => {
    const workbook = await read();
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['2026', '2025']);
  });

  it('writes one worksheet per year, newest first', async () => {
    const workbook = await read();
    expect(workbook.getWorksheet('2026')!.rowCount - 1).toBe(1);
    expect(workbook.getWorksheet('2025')!.rowCount - 1).toBe(1);
  });

  it('lays each row out as position, company, date, status, notes', async () => {
    const workbook = await read();
    const row = workbook.getWorksheet('2026')!.getRow(2);

    expect(row.getCell(1).value).toBe('Backend Engineer');
    expect(row.getCell(2).value).toBe('Spotify');
    expect(row.getCell(3).value).toBe('2026-03-12');
    expect(row.getCell(4).value).toBe('Interview');
    expect(row.getCell(5).value).toBe('Take-home went well.');
  });

  it('leaves the notes cell blank when there are none', async () => {
    const workbook = await read();
    const row = workbook.getWorksheet('2025')!.getRow(2);
    expect(row.getCell(5).value ?? '').toBe('');
  });

  it('wraps the notes column so multi-line notes are visible', async () => {
    const workbook = await read();
    const row = workbook.getWorksheet('2026')!.getRow(2);
    expect(row.alignment).toMatchObject({ wrapText: true, vertical: 'top' });
  });

  it('freezes the header row and adds an autofilter', async () => {
    const workbook = await read();
    const sheet = workbook.getWorksheet('2026')!;
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
  });

  it('produces a valid workbook with headers even when nothing matches', async () => {
    const workbook = await read([]);
    const sheet = workbook.getWorksheet('Applications')!;
    expect(sheet).toBeTruthy();
    expect(sheet.getRow(1).getCell(1).value).toBe('Position');
  });
});
