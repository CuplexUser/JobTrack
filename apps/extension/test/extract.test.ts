/**
 * What the popup makes of a page it has just read.
 *
 * `buildDraft` is the one piece of the extension that decides what gets saved, and it is
 * pure: a snapshot in, a draft out. So it is tested directly, with the snapshots the page
 * reader produces on the shapes that actually turn up — structured data that names no city,
 * a board with no structured data at all, and a page that answers nothing.
 */

import { describe, expect, it } from 'vitest';
import { buildDraft, simplifyLocation } from '../src/extract.js';
import type { PageSnapshot } from '../src/page-reader.js';

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: 'https://boards.greenhouse.io/acme/jobs/7',
    hostname: 'boards.greenhouse.io',
    title: 'Backend Engineer - Acme',
    selection: '',
    ldBlocks: [],
    ...overrides,
    fields: {
      title: '',
      company: '',
      location: '',
      salary: '',
      description: '',
      ...overrides.fields,
    },
  };
}

/** A posting stating who and what, but not where — which is most of them. */
const PARTIAL_LD = JSON.stringify({
  '@type': 'JobPosting',
  title: 'Senior Backend Engineer',
  hiringOrganization: { name: 'Acme Robotics' },
});

describe('buildDraft', () => {
  it('takes the location off the page when the structured data names none', () => {
    const { draft, method } = buildDraft(
      snapshot({
        ldBlocks: [PARTIAL_LD],
        fields: { title: '', company: '', location: 'Stockholm', salary: '', description: '' },
      }),
    );

    expect(method).toContain('structured data');
    expect(draft.companyName).toBe('Acme Robotics');
    expect(draft.location).toBe('Stockholm');
  });

  it('falls back to a location the description labels', () => {
    const { draft } = buildDraft(
      snapshot({
        ldBlocks: [PARTIAL_LD],
        fields: {
          title: '',
          company: '',
          location: '',
          salary: '',
          description: 'About the role\nLocation: Gothenburg\nYou will own the build pipeline.',
        },
      }),
    );

    expect(draft.location).toBe('Gothenburg');
    expect(draft.notes).toContain('build pipeline');
  });

  it('keeps the site navigation out of the note', () => {
    const { draft } = buildDraft(
      snapshot({
        ldBlocks: [PARTIAL_LD],
        fields: {
          title: '',
          company: '',
          location: '',
          salary: '',
          description: ['Log in', 'Language', 'Search', 'You will own the build pipeline.'].join('\n'),
        },
      }),
    );

    expect(draft.notes).toBe('You will own the build pipeline.');
  });

  it('reads a board with no structured data from its own layout', () => {
    const { draft, method } = buildDraft(
      snapshot({
        url: 'https://www.linkedin.com/jobs/view/99',
        hostname: 'www.linkedin.com',
        fields: {
          title: 'Platform Engineer',
          company: 'Volvo Cars',
          location: 'Gothenburg, hybrid',
          salary: 'SEK 60 000 - 70 000 / month',
          description: 'We are looking for someone to own our deployment pipeline.',
        },
      }),
    );

    expect(method).toContain('LinkedIn');
    expect(draft.companyName).toBe('Volvo Cars');
    expect(draft.location).toBe('Gothenburg, hybrid');
    expect(draft.workMode).toBe('hybrid');
    expect(draft.salaryMin).toBe(60000);
    expect(draft.sourceName).toBe('LinkedIn');
  });

  it('falls back to the page title, and notes the posting rather than the title', () => {
    const { draft, method } = buildDraft(
      snapshot({
        title: 'Backend Engineer - Acme - Stockholm',
        fields: {
          title: '',
          company: '',
          location: '',
          salary: '',
          description: 'You will own the build pipeline.',
        },
      }),
    );

    expect(method).toBe('the page title');
    expect(draft.jobTitle).toBe('Backend Engineer');
    expect(draft.companyName).toBe('Acme');
    expect(draft.notes).toBe('You will own the build pipeline.');
  });

  it('reads LinkedIn’s "Company hiring Title in Location" tab title when the selectors miss', () => {
    const { draft, method } = buildDraft(
      snapshot({
        url: 'https://www.linkedin.com/jobs/view/99',
        hostname: 'www.linkedin.com',
        title: 'Volvo Cars hiring Platform Engineer in Gothenburg, Sweden | LinkedIn',
        fields: { title: '', company: '', location: '', salary: '', description: '' },
      }),
    );

    expect(method).toContain('linkedin.com');
    expect(draft.companyName).toBe('Volvo Cars');
    expect(draft.jobTitle).toBe('Platform Engineer');
    expect(draft.location).toBe('Gothenburg, Sweden');
    expect(draft.sourceName).toBe('LinkedIn');
  });

  it('does not misread Indeed’s title as naming a company when it only names a location', () => {
    // Indeed's title is often "Title - Location - Indeed.com" with no company at all. The
    // generic "second line is the company" fallback used to read "Gothenburg" as the employer.
    const { draft, method } = buildDraft(
      snapshot({
        url: 'https://www.indeed.com/viewjob?jk=abc',
        hostname: 'www.indeed.com',
        title: 'Platform Engineer - Gothenburg - Indeed.com',
        fields: { title: '', company: '', location: '', salary: '', description: '' },
      }),
    );

    expect(method).toContain('indeed.com');
    expect(draft.jobTitle).toBe('Platform Engineer');
    expect(draft.companyName).toBe('');
    expect(draft.location).toBe('Gothenburg');
  });

  it('reads company and location out of Indeed’s title when both are present', () => {
    const { draft } = buildDraft(
      snapshot({
        url: 'https://www.indeed.com/viewjob?jk=abc',
        hostname: 'www.indeed.com',
        title: 'Platform Engineer - Volvo Cars - Gothenburg - Indeed.com',
        fields: { title: '', company: '', location: '', salary: '', description: '' },
      }),
    );

    expect(draft.jobTitle).toBe('Platform Engineer');
    expect(draft.companyName).toBe('Volvo Cars');
    expect(draft.location).toBe('Gothenburg');
  });

  it('reads å/ä/ö in a Swedish city name out of LinkedIn and Indeed titles', () => {
    const linkedin = buildDraft(
      snapshot({
        url: 'https://www.linkedin.com/jobs/view/99',
        hostname: 'www.linkedin.com',
        title: 'Klarna hiring Backend-utvecklare in Malmö, Skåne län | LinkedIn',
        fields: { title: '', company: '', location: '', salary: '', description: '' },
      }),
    ).draft;
    expect(linkedin.companyName).toBe('Klarna');
    expect(linkedin.jobTitle).toBe('Backend-utvecklare');
    expect(linkedin.location).toBe('Malmö, Skåne län');

    const indeed = buildDraft(
      snapshot({
        url: 'https://www.indeed.com/viewjob?jk=abc',
        hostname: 'www.indeed.com',
        title: 'Backend-utvecklare - Volvo Cars - Göteborg - Indeed.com',
        fields: { title: '', company: '', location: '', salary: '', description: '' },
      }),
    ).draft;
    expect(indeed.jobTitle).toBe('Backend-utvecklare');
    expect(indeed.companyName).toBe('Volvo Cars');
    expect(indeed.location).toBe('Göteborg');
  });
});

describe('simplifyLocation', () => {
  it('drops a region behind a plain "City, Region" pair', () => {
    expect(simplifyLocation('Lund, Skåne län')).toBe('Lund');
    expect(simplifyLocation('Malmö, Skåne län')).toBe('Malmö');
  });

  it('leaves a location with no comma alone', () => {
    expect(simplifyLocation('Lund')).toBe('Lund');
  });

  it('leaves a parenthesized remote location alone, comma and all', () => {
    expect(simplifyLocation('Remote (Sweden, Norway)')).toBe('Remote (Sweden, Norway)');
  });

  it('leaves more than two comma-separated parts alone, rather than guess which is the city', () => {
    expect(simplifyLocation('Lund, Skåne, Sweden')).toBe('Lund, Skåne, Sweden');
  });
});
