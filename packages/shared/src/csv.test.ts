import { describe, expect, it } from 'vitest';
import { escapeCsvField, toCsv, toCsvRow, UTF8_BOM } from './csv.js';

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
