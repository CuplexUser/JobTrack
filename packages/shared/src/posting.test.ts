import { describe, expect, it } from 'vitest';
import {
  canonicalJobUrl,
  isUsableDraft,
  parseJsonLdPosting,
  parsePostingText,
  parseSalaryText,
  sourceFromUrl,
  workModeFromText,
} from './posting.js';

/**
 * Shaped after a real Greenhouse posting: JSON-LD in a `<script>`, salary as a
 * `MonetaryAmount`, location as a nested `PostalAddress`.
 */
const GREENHOUSE_HTML = `
<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "http://schema.org",
  "@type": "JobPosting",
  "title": "Senior Backend Engineer",
  "datePosted": "2026-08-01",
  "hiringOrganization": { "@type": "Organization", "name": "Acme Robotics" },
  "jobLocation": {
    "@type": "Place",
    "address": { "@type": "PostalAddress", "addressLocality": "Stockholm", "addressCountry": "SE" }
  },
  "baseSalary": {
    "@type": "MonetaryAmount",
    "currency": "SEK",
    "value": { "@type": "QuantitativeValue", "minValue": 55000, "maxValue": 75000, "unitText": "MONTH" }
  }
}
</script>
</head><body>irrelevant</body></html>`;

/** Lever wraps its nodes in an `@graph`, and marks remote roles with `jobLocationType`. */
const LEVER_HTML = `
<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "name": "Jobs at Initech" },
    {
      "@type": ["JobPosting"],
      "title": "Staff Data Engineer",
      "url": "https://jobs.lever.co/initech/abc-123",
      "hiringOrganization": { "name": "Initech" },
      "jobLocationType": "TELECOMMUTE",
      "jobLocation": { "address": { "addressLocality": "Remote", "addressCountry": { "name": "Sweden" } } }
    }
  ]
}
</script>
</head><body></body></html>`;

describe('sourceFromUrl', () => {
  it('names the sites worth grouping by', () => {
    expect(sourceFromUrl('https://www.linkedin.com/jobs/view/12345/')).toBe('LinkedIn');
    expect(sourceFromUrl('https://boards.greenhouse.io/acme/jobs/7')).toBe('Greenhouse');
    expect(sourceFromUrl('https://job-boards.greenhouse.io/acme/jobs/7')).toBe('Greenhouse');
    expect(sourceFromUrl('https://jobs.lever.co/initech/abc')).toBe('Lever');
    expect(sourceFromUrl('https://acme.wd3.myworkdayjobs.com/careers/job/1')).toBe('Workday');
  });

  it('falls back to the bare hostname for a company careers page', () => {
    expect(sourceFromUrl('https://www.acme.se/careers/backend')).toBe('acme.se');
  });

  it('returns null for something that is not a URL', () => {
    expect(sourceFromUrl('backend engineer')).toBeNull();
  });
});

describe('canonicalJobUrl', () => {
  it('sees through the ways one link gets written differently', () => {
    const canonical = canonicalJobUrl('https://boards.greenhouse.io/acme/jobs/7');
    expect(canonicalJobUrl('http://www.boards.greenhouse.io/acme/jobs/7/')).toBe(canonical);
    expect(canonicalJobUrl('  https://BOARDS.greenhouse.io/acme/jobs/7#apply  ')).toBe(canonical);
    expect(canonicalJobUrl('https://boards.greenhouse.io/acme/jobs/7?utm_source=newsletter&gh_src=x')).toBe(
      canonical,
    );
  });

  it('keeps the query parameters that name the posting', () => {
    // LinkedIn puts the posting's identity in the query, so dropping it wholesale would
    // make every job on the site look like the same one.
    expect(canonicalJobUrl('https://www.linkedin.com/jobs/view/?currentJobId=1')).not.toBe(
      canonicalJobUrl('https://www.linkedin.com/jobs/view/?currentJobId=2'),
    );
    expect(canonicalJobUrl('https://example.com/j?a=1&b=2')).toBe(
      canonicalJobUrl('https://example.com/j?b=2&a=1'),
    );
  });

  it('keeps two genuinely different postings apart', () => {
    expect(canonicalJobUrl('https://example.com/jobs/1')).not.toBe(
      canonicalJobUrl('https://example.com/jobs/2'),
    );
  });

  it('is null for anything that is not an absolute URL', () => {
    expect(canonicalJobUrl('/jobs/7')).toBeNull();
    expect(canonicalJobUrl('not a url')).toBeNull();
  });
});

describe('workModeFromText', () => {
  it('prefers the more specific arrangement over the bare word remote', () => {
    expect(workModeFromText('Hybrid — 2 remote days a week')).toBe('hybrid');
    expect(workModeFromText('On-site in Malmö, occasional remote')).toBe('onsite');
    expect(workModeFromText('Fully remote within the EU')).toBe('remote');
    expect(workModeFromText('Stockholm')).toBe('unspecified');
  });
});

describe('parseSalaryText', () => {
  it('reads a range with a currency code', () => {
    expect(parseSalaryText('Salary: SEK 55 000 - 75 000 per month')).toEqual({
      min: 55000,
      max: 75000,
      currency: 'SEK',
    });
  });

  it('understands symbols and the k suffix', () => {
    expect(parseSalaryText('$120k – $150k')).toEqual({ min: 120000, max: 150000, currency: 'USD' });
  });

  it('orders a reversed range', () => {
    const parsed = parseSalaryText('€90,000 (down from €110,000)');
    expect(parsed.min).toBe(90000);
    expect(parsed.max).toBe(110000);
  });

  it('refuses to guess when no currency is named', () => {
    expect(parseSalaryText('We are 1,000 people across 12 offices')).toEqual({
      min: null,
      max: null,
      currency: null,
    });
  });

  it('ignores numbers too small to be a salary, and the 401(k) that looks like one', () => {
    // Nothing clears the floor, so there is no salary here at all — currency included.
    expect(parseSalaryText('USD, 12 days of leave')).toEqual({ min: null, max: null, currency: null });
    expect(parseSalaryText('$401(k) match and 25 days of leave').min).toBeNull();
    expect(parseSalaryText('401k plan, $120,000 base').min).toBe(120000);
  });
});

describe('parseJsonLdPosting', () => {
  it('reads a Greenhouse-style posting', () => {
    const draft = parseJsonLdPosting(GREENHOUSE_HTML, 'https://boards.greenhouse.io/acme/jobs/7');
    expect(draft).not.toBeNull();
    expect(draft!.companyName).toBe('Acme Robotics');
    expect(draft!.jobTitle).toBe('Senior Backend Engineer');
    expect(draft!.location).toBe('Stockholm, SE');
    expect(draft!.salaryMin).toBe(55000);
    expect(draft!.salaryMax).toBe(75000);
    expect(draft!.salaryCurrency).toBe('SEK');
    expect(draft!.sourceName).toBe('Greenhouse');
    expect(draft!.jobUrl).toBe('https://boards.greenhouse.io/acme/jobs/7');
    expect(isUsableDraft(draft!)).toBe(true);
  });

  it('finds a posting nested in an @graph and honors TELECOMMUTE', () => {
    const draft = parseJsonLdPosting(LEVER_HTML);
    expect(draft).not.toBeNull();
    expect(draft!.companyName).toBe('Initech');
    expect(draft!.jobTitle).toBe('Staff Data Engineer');
    expect(draft!.workMode).toBe('remote');
    expect(draft!.sourceName).toBe('Lever');
  });

  it('returns null when the page carries no JobPosting', () => {
    expect(parseJsonLdPosting('<html><body><h1>About us</h1></body></html>')).toBeNull();
    expect(
      parseJsonLdPosting('<script type="application/ld+json">{"@type":"Organization"}</script>'),
    ).toBeNull();
  });

  it('skips a malformed JSON-LD block instead of throwing', () => {
    const html = `<script type="application/ld+json">{ not json </script>${GREENHOUSE_HTML}`;
    expect(parseJsonLdPosting(html)?.companyName).toBe('Acme Robotics');
  });
});

describe('parsePostingText', () => {
  it('splits "Title at Company", and takes the line under it as the location', () => {
    const draft = parsePostingText('Backend Engineer at Spotify\nStockholm, Sweden');
    expect(draft.jobTitle).toBe('Backend Engineer');
    expect(draft.companyName).toBe('Spotify');
    expect(draft.location).toBe('Stockholm, Sweden');
  });

  it('reads a location off a hyphenated line without mistaking a city for an employer', () => {
    const draft = parsePostingText('Senior Platform Engineer at Volvo Cars\nGothenburg - hybrid');
    expect(draft.companyName).toBe('Volvo Cars');
    expect(draft.location).toBe('Gothenburg');
    expect(draft.workMode).toBe('hybrid');
  });

  it('does not mistake the opening sentence of a description for a location', () => {
    const draft = parsePostingText(
      'Backend Engineer at Spotify\nWe are looking for someone to own our search stack.',
    );
    expect(draft.location).toBeNull();
  });

  it('splits a pipe-separated header line', () => {
    const draft = parsePostingText('Staff Engineer | Klarna | Stockholm');
    expect(draft.jobTitle).toBe('Staff Engineer');
    expect(draft.companyName).toBe('Klarna');
    expect(draft.location).toBe('Stockholm');
  });

  it('takes the company from the second line when the first is a bare title', () => {
    const draft = parsePostingText('Site Reliability Engineer\nEricsson\nLocation: Kista');
    expect(draft.jobTitle).toBe('Site Reliability Engineer');
    expect(draft.companyName).toBe('Ericsson');
    expect(draft.location).toBe('Kista');
  });

  it('picks up salary and work mode from the body, and keeps the full text as a note', () => {
    const text = [
      'Platform Engineer at Volvo',
      'Gothenburg — hybrid',
      'Salary: SEK 60 000 - 70 000 / month',
      'We are looking for someone to own our deployment pipeline.',
    ].join('\n');
    const draft = parsePostingText(text, 'https://www.linkedin.com/jobs/view/99');

    expect(draft.companyName).toBe('Volvo');
    expect(draft.workMode).toBe('hybrid');
    expect(draft.salaryMin).toBe(60000);
    expect(draft.salaryMax).toBe(70000);
    expect(draft.salaryCurrency).toBe('SEK');
    expect(draft.sourceName).toBe('LinkedIn');
    expect(draft.notes).toContain('deployment pipeline');
  });

  it('is unusable rather than wrong when there is nothing to go on', () => {
    const draft = parsePostingText('');
    expect(isUsableDraft(draft)).toBe(false);
    expect(draft.companyName).toBe('');
  });
});
