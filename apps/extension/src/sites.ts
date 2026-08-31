/**
 * Per-site DOM selectors, all in one table.
 *
 * **These will break.** LinkedIn and Indeed reshuffle their markup on their own schedule
 * and owe this extension nothing, so treat a wrong or empty field as expected maintenance
 * rather than a mystery: find the site below, fix the selector, done. Keeping every one of
 * them in a single small file is the whole point — the alternative is selectors sprinkled
 * through extraction logic, where a break becomes an investigation.
 *
 * Nothing here is load-bearing. Extraction tries schema.org JSON-LD first, which most
 * applicant tracking systems publish and which does not rot, and falls back to the page
 * title and the user's own text selection when neither works. These selectors only make the
 * two big job boards — the two that JSON-LD and server-side fetching both fail on — nice
 * rather than merely possible.
 */

export interface SiteRules {
  /** Matched against the tail of the hostname. */
  host: string;
  /** Shown in the popup so it is obvious which rules ran. */
  label: string;
  title?: string[];
  company?: string[];
  location?: string[];
  salary?: string[];
  description?: string[];
}

export const SITE_RULES: readonly SiteRules[] = [
  {
    host: 'linkedin.com',
    label: 'LinkedIn',
    title: ['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', 'h1'],
    company: [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
    ],
    location: [
      '.job-details-jobs-unified-top-card__primary-description-container span:first-child',
      '.jobs-unified-top-card__bullet',
    ],
    salary: ['.jobs-details__salary-main-rail-card', '.job-details-jobs-unified-top-card__job-insight'],
    description: ['#job-details', '.jobs-description__content'],
  },
  {
    host: 'indeed.com',
    label: 'Indeed',
    title: ['.jobsearch-JobInfoHeader-title', 'h1.jobsearch-JobInfoHeader-title', 'h1'],
    company: ['[data-testid="inlineHeader-companyName"]', '.jobsearch-CompanyInfoContainer a'],
    location: ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]'],
    salary: ['#salaryInfoAndJobType', '[data-testid="attribute_snippet_testid"]'],
    description: ['#jobDescriptionText'],
  },
  {
    host: 'glassdoor.com',
    label: 'Glassdoor',
    title: ['[data-test="job-title"]', 'h1'],
    company: ['[data-test="employer-name"]'],
    location: ['[data-test="location"]'],
    description: ['[class*="JobDetails_jobDescription"]'],
  },
];

export function rulesFor(hostname: string): SiteRules | null {
  const host = hostname.toLowerCase();
  return SITE_RULES.find((rule) => host === rule.host || host.endsWith(`.${rule.host}`)) ?? null;
}
