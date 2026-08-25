import { describe, expect, it } from 'vitest';
import { escapeCsvField, parseCsv, toCsv, toCsvLines, toCsvRow, UTF8_BOM } from './csv.js';

describe('escapeCsvField', () => {
  it('leaves plain values alone', () => {
    expect(escapeCsvField('Backend Engineer')).toBe('Backend Engineer');
  });

  it('quotes values containing a comma', () => {
    // The failure this prevents: an unquoted comma shifts every later column.
    expect(escapeCsvField('ai, remote-ok')).toBe('"ai, remote-ok"');
  });

  it('doubles inner quotes', () => {
    expect(escapeCsvField('Senior "Staff" Engineer')).toBe('"Senior ""Staff"" Engineer"');
  });

  it('quotes values containing newlines', () => {
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"');
  });

  it('renders null and undefined as empty', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('keeps zero rather than treating it as absent', () => {
    expect(escapeCsvField(0)).toBe('0');
  });
});

describe('toCsvRow', () => {
  it('joins escaped fields', () => {
    expect(toCsvRow(['2026-03-12', 'Spotify', 'a, b'])).toBe('2026-03-12,Spotify,"a, b"');
  });
});

describe('toCsv', () => {
  const columns = [
    { header: 'Company', value: (r: { company: string }) => r.company },
  ];

  it('starts with a BOM so Excel reads UTF-8 correctly', () => {
    const csv = toCsv([{ company: 'Ericsson Malmö' }], columns);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain('Malmö');
  });

  it('uses CRLF line endings', () => {
    const csv = toCsv([{ company: 'A' }, { company: 'B' }], columns, { bom: false });
    expect(csv).toBe('Company\r\nA\r\nB\r\n');
  });

  it('can omit the BOM', () => {
    expect(toCsv([], columns, { bom: false }).startsWith(UTF8_BOM)).toBe(false);
  });
});

describe('parseCsv', () => {
  it('splits plain rows on commas', () => {
    expect(parseCsv('a,b,c\r\n1,2,3\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('strips a leading BOM', () => {
    expect(parseCsv(`${UTF8_BOM}a,b\r\n1,2\r\n`)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    expect(parseCsv('Position,Company\r\n"Platform, Engineer",Klarna\r\n')).toEqual([
      ['Position', 'Company'],
      ['Platform, Engineer', 'Klarna'],
    ]);
  });

  it('un-doubles a quote inside a quoted field', () => {
    expect(parseCsv('Title\r\n"Senior ""Staff"" Engineer"\r\n')).toEqual([
      ['Title'],
      ['Senior "Staff" Engineer'],
    ]);
  });

  it('keeps a newline inside a quoted field as one row', () => {
    expect(parseCsv('Notes\r\n"line one\nline two"\r\n')).toEqual([['Notes'], ['line one\nline two']]);
  });

  it('accepts bare LF as well as CRLF', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('does not require a trailing line terminator', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops a blank line rather than returning a one-empty-cell row', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n3,4\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('round-trips what toCsvLines writes', () => {
    const rows = [
      { company: 'Ericsson Malmö', title: 'Platform, Engineer' },
      { company: 'Klarna', title: 'Backend "Staff" Engineer' },
    ];
    const columns = [
      { header: 'Company', value: (r: (typeof rows)[number]) => r.company },
      { header: 'Title', value: (r: (typeof rows)[number]) => r.title },
    ];
    const csv = [...toCsvLines(rows, columns)].join('');

    expect(parseCsv(csv)).toEqual([
      ['Company', 'Title'],
      ['Ericsson Malmö', 'Platform, Engineer'],
      ['Klarna', 'Backend "Staff" Engineer'],
    ]);
  });
});
