/**
 * Reading LinkedIn's own data export.
 *
 * LinkedIn lets every member download their data (Settings, Data privacy, Get a copy of your
 * data), and the archive includes `Connections.csv`. That file is the user's own network,
 * handed to them by LinkedIn, which is what makes importing it fine where scraping profiles
 * would not be.
 *
 * The file is not a plain CSV. It opens with a few lines of notes about missing email
 * addresses before the real header row, so the header is found by looking for it rather
 * than assumed to be line one.
 */

import { parseCsv } from './csv.js';

export interface LinkedInConnection {
  /** Which connection this is in the file, counting from 1, for pointing at a row in a preview. */
  rowNumber: number;
  name: string;
  linkedinUrl: string | null;
  email: string | null;
  companyName: string | null;
  headline: string | null;
  /** YYYY-MM-DD, or null when the file had none or it could not be read. */
  connectedOn: string | null;
}

export interface LinkedInParseResult {
  rows: LinkedInConnection[];
  /** Problems with the file as a whole, such as a missing header. */
  errors: string[];
}

const REQUIRED_HEADERS = ['first name', 'last name'] as const;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * LinkedIn writes "12 Mar 2024". ISO dates are accepted too, for a file someone tidied up
 * in a spreadsheet first.
 */
export function parseConnectedOn(value: string): string | null {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const match = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS[match[2]!.toLowerCase()];
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * One spelling for a profile link, so the same person imported twice is recognized:
 * `https://www.linkedin.com/in/<slug>` with the slug lowercased and any query dropped.
 * Anything that is not a `/in/` profile link is returned trimmed but otherwise unchanged.
 */
export function canonicalLinkedInUrl(url: string | null | undefined): string | null {
  const text = url?.trim();
  if (!text) return null;
  const match = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(text);
  if (!match) return text;
  return `https://www.linkedin.com/in/${decodeURIComponentSafe(match[1]!).toLowerCase()}`;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseLinkedInConnections(text: string): LinkedInParseResult {
  const lines = parseCsv(text);
  const headerIndex = lines.findIndex((cells) => {
    const names = cells.map((cell) => cell.trim().toLowerCase());
    return REQUIRED_HEADERS.every((header) => names.includes(header));
  });

  if (headerIndex === -1) {
    return {
      rows: [],
      errors: [
        'This does not look like LinkedIn\'s Connections.csv: no "First Name" and "Last Name" header was found.',
      ],
    };
  }

  const header = lines[headerIndex]!.map((cell) => cell.trim().toLowerCase());
  const column = (name: string): number => header.indexOf(name);
  const at = (cells: string[], name: string): string | null => {
    const index = column(name);
    const value = index === -1 ? '' : (cells[index] ?? '').trim();
    return value === '' ? null : value;
  };

  const rows: LinkedInConnection[] = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const cells = lines[i]!;
    if (cells.every((cell) => cell.trim() === '')) continue;

    const name = [at(cells, 'first name'), at(cells, 'last name')].filter(Boolean).join(' ');
    const connectedOn = at(cells, 'connected on');
    rows.push({
      rowNumber: rows.length + 1,
      name,
      linkedinUrl: canonicalLinkedInUrl(at(cells, 'url')),
      email: at(cells, 'email address'),
      companyName: at(cells, 'company'),
      headline: at(cells, 'position'),
      connectedOn: connectedOn ? parseConnectedOn(connectedOn) : null,
    });
  }

  return { rows, errors: [] };
}
