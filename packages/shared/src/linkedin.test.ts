import { describe, expect, it } from 'vitest';
import { canonicalLinkedInUrl, parseConnectedOn, parseLinkedInConnections } from './linkedin.js';

/** The shape LinkedIn's export actually has: notes first, the header a few lines down. */
const EXPORT = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Maria,Lindqvist,https://www.linkedin.com/in/MariaLindqvist/,maria@example.com,Spotify,"Engineering Manager, Backend",12 Mar 2024
Johan,Berg,https://se.linkedin.com/in/johanberg?trk=abc,,Klarna AB,Senior Technical Recruiter,03 Jan 2023
,,,,,,
Sara,,https://www.linkedin.com/in/sara-n,,,,
`;

describe('parseLinkedInConnections', () => {
  it('finds the header below the notes and reads every connection', () => {
    const { rows, errors } = parseLinkedInConnections(EXPORT);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      rowNumber: 1,
      name: 'Maria Lindqvist',
      linkedinUrl: 'https://www.linkedin.com/in/marialindqvist',
      email: 'maria@example.com',
      companyName: 'Spotify',
      headline: 'Engineering Manager, Backend',
      connectedOn: '2024-03-12',
    });
  });

  it('leaves absent fields null and skips blank lines', () => {
    const { rows } = parseLinkedInConnections(EXPORT);
    expect(rows[1]).toMatchObject({ name: 'Johan Berg', email: null, companyName: 'Klarna AB', connectedOn: '2023-01-03' });
    expect(rows[2]).toMatchObject({ name: 'Sara', companyName: null, headline: null, connectedOn: null });
  });

  it('reports a file that is not a connections export', () => {
    const { rows, errors } = parseLinkedInConnections('Position,Company,Date\nEngineer,Spotify,2026-01-01\n');
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});

describe('parseConnectedOn', () => {
  it('reads LinkedIn dates and ISO dates, and gives up on anything else', () => {
    expect(parseConnectedOn('5 Sep 2025')).toBe('2025-09-05');
    expect(parseConnectedOn('2025-09-05')).toBe('2025-09-05');
    expect(parseConnectedOn('September 5th')).toBeNull();
    expect(parseConnectedOn('40 Sep 2025')).toBeNull();
  });
});

describe('canonicalLinkedInUrl', () => {
  it('spells one profile one way, whatever subdomain, case or tracking it came with', () => {
    const canonical = 'https://www.linkedin.com/in/johanberg';
    expect(canonicalLinkedInUrl('https://se.linkedin.com/in/JohanBerg/?trk=x')).toBe(canonical);
    expect(canonicalLinkedInUrl('linkedin.com/in/johanberg')).toBe(canonical);
  });

  it('keeps other links as typed, and treats empty as none', () => {
    expect(canonicalLinkedInUrl(' https://example.com/me ')).toBe('https://example.com/me');
    expect(canonicalLinkedInUrl('  ')).toBeNull();
    expect(canonicalLinkedInUrl(undefined)).toBeNull();
  });
});
