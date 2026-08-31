/**
 * Turning a job posting — wherever it came from — into the fields a saved opening needs.
 *
 * Three callers share this file, which is why it lives in `shared` and stays browser-safe:
 * the API parses HTML it fetched, the web app parses text somebody pasted, and the browser
 * extension parses the page the user is looking at. One parser means a Greenhouse posting
 * produces the same record through all three routes.
 *
 * Everything here is best-effort by nature. A `PostingDraft` is a *draft*: it is shown in a
 * form for the user to correct before anything is saved, so a missing salary or a slightly
 * wrong title is a small annoyance rather than bad data. The one field that must never be
 * guessed loosely is the company name, because it drives duplicate detection — so when the
 * company cannot be identified, it comes back empty and the form asks for it.
 */

import { WORK_MODES, type WorkMode } from './types.js';

/**
 * What every parser produces and the opening form consumes. Deliberately the same shape as
 * `createJobOpeningSchema`'s input (minus `savedOn`, which the server dates), so a draft
 * can be handed straight to the existing create path with no field mapping in between.
 */
export interface PostingDraft {
  companyName: string;
  jobTitle: string;
  jobUrl: string | null;
  location: string | null;
  workMode: WorkMode;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  sourceName: string | null;
  notes: string | null;
}

export function emptyDraft(): PostingDraft {
  return {
    companyName: '',
    jobTitle: '',
    jobUrl: null,
    location: null,
    workMode: 'unspecified',
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    sourceName: null,
    notes: null,
  };
}

/** A draft is worth showing only if it identified the two fields an opening cannot do without. */
export function isUsableDraft(draft: PostingDraft): boolean {
  return draft.companyName.trim() !== '' && draft.jobTitle.trim() !== '';
}

// ---------------------------------------------------------------- source names

/**
 * Hosts worth naming, so the `sourceName` column reads "LinkedIn" rather than
 * "www.linkedin.com" — that column is what per-source response rates are grouped by later,
 * and grouping only works if the same site always produces the same string.
 *
 * Matched on the registrable-ish tail of the hostname, so `boards.greenhouse.io`,
 * `job-boards.greenhouse.io` and `greenhouse.io` are all Greenhouse.
 */
const KNOWN_SOURCES: readonly (readonly [string, string])[] = [
  ['linkedin.com', 'LinkedIn'],
  ['indeed.com', 'Indeed'],
  ['glassdoor.com', 'Glassdoor'],
  ['greenhouse.io', 'Greenhouse'],
  ['lever.co', 'Lever'],
  ['ashbyhq.com', 'Ashby'],
  ['workday.com', 'Workday'],
  ['myworkdayjobs.com', 'Workday'],
  ['smartrecruiters.com', 'SmartRecruiters'],
  ['teamtailor.com', 'Teamtailor'],
  ['workable.com', 'Workable'],
  ['recruitee.com', 'Recruitee'],
  ['jobvite.com', 'Jobvite'],
  ['icims.com', 'iCIMS'],
  ['taleo.net', 'Taleo'],
  ['arbetsformedlingen.se', 'Arbetsförmedlingen'],
  ['thehub.io', 'The Hub'],
  ['otta.com', 'Otta'],
  ['wellfound.com', 'Wellfound'],
  ['stackoverflow.com', 'Stack Overflow'],
];

/**
 * The host out of a URL, by hand.
 *
 * `new URL()` exists in every runtime this package runs in, but its *type* lives in the DOM
 * or Node libraries, and this package compiles against neither on purpose — that is what
 * keeps it safe to import from a browser bundle. A hostname is all that is wanted here, and
 * a scheme-and-authority match gets it without claiming an environment.
 */
const URL_HOST = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]+)/i;

export function hostnameFromUrl(url: string): string | null {
  const match = URL_HOST.exec(url.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * "https://boards.greenhouse.io/acme/jobs/123" -> "Greenhouse".
 *
 * Falls back to the hostname without `www.`, which is still a usable grouping key for a
 * company's own careers page. Null only when the input is not a URL at all.
 */
export function sourceFromUrl(url: string): string | null {
  const host = hostnameFromUrl(url);
  if (host === null) return null;
  for (const [suffix, label] of KNOWN_SOURCES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return label;
  }
  return host.replace(/^www\./, '') || null;
}

/**
 * The parts of a URL that identify a *posting*, as one comparable string.
 *
 * Two captures of the same job ad are rarely two identical strings: the link is reached
 * once over http and once over https, once with `www.`, once with a trailing slash, and
 * very often with a tail of `?utm_source=…` or `?ref=…` that records how the visitor
 * arrived rather than what they arrived at. Comparing raw URLs would call all of those
 * different postings and let the same ad be saved again and again.
 *
 * What is deliberately *kept* is the rest of the query string, because several job boards
 * put the posting's identity there — LinkedIn's `currentJobId`, Workday's `jobId`. Dropping
 * the query wholesale would collapse every posting on such a board into one.
 *
 * Null when the input is not an absolute URL, which is the caller's cue not to compare at
 * all rather than to treat two unparseable strings as equal.
 */
const URL_PARTS = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]+)(?::\d+)?([^?#]*)(?:\?([^#]*))?/i;

/** Prefixes every analytics suite uses for its own bookkeeping. */
const TRACKING_PREFIX = /^(utm_|ga_|mc_|hs[a_])/;

/** Named parameters that say where a visitor came from, not which posting they landed on. */
const TRACKING_PARAMS = new Set([
  'src',
  'source',
  'ref',
  'refid',
  'referrer',
  'gh_src',
  'trk',
  'trackingid',
  'fbclid',
  'gclid',
  'msclkid',
  'lipi',
  'licu',
  'originalsubdomain',
  'position',
  'pagenum',
]);

export function canonicalJobUrl(url: string): string | null {
  const match = URL_PARTS.exec(url.trim());
  if (!match) return null;

  const host = match[1]!.toLowerCase().replace(/^www\./, '');
  // Paths are case-sensitive on plenty of servers, so only the trailing slash is normalized.
  const path = (match[2] ?? '').replace(/\/+$/, '');
  const query = (match[3] ?? '')
    .split('&')
    .filter((pair) => pair !== '')
    .filter((pair) => {
      const name = pair.split('=')[0]!.toLowerCase();
      return !TRACKING_PREFIX.test(name) && !TRACKING_PARAMS.has(name);
    })
    // Sorted, because the order parameters appear in is not part of what a link points at.
    .sort();

  return `${host}${path}${query.length > 0 ? `?${query.join('&')}` : ''}`;
}

// ---------------------------------------------------------------- shared bits

/** Collapse the whitespace and entity noise that survives extraction from HTML or a page. */
function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trimmed text, or null — matching how the schemas treat an empty box as "not set". */
function orNull(value: string, max: number): string | null {
  const text = clean(value);
  if (text === '') return null;
  return text.length > max ? text.slice(0, max) : text;
}

const REMOTE_WORDS = /\b(remote|distans|distansarbete|work from home|wfh|telecommute)\b/i;
const HYBRID_WORDS = /\b(hybrid|partially remote|part remote|flexible location)\b/i;
const ONSITE_WORDS = /\b(on[- ]?site|onsite|in[- ]office|in the office|på plats)\b/i;

/**
 * Work mode from free text. Order matters: "hybrid remote" is hybrid, and a posting saying
 * "on-site, some remote days" is on-site — the more specific arrangement wins over the
 * bare word "remote", which appears in almost every posting that mentions location at all.
 */
export function workModeFromText(text: string): WorkMode {
  if (HYBRID_WORDS.test(text)) return 'hybrid';
  if (ONSITE_WORDS.test(text)) return 'onsite';
  if (REMOTE_WORDS.test(text)) return 'remote';
  return 'unspecified';
}

function isWorkMode(value: string): value is WorkMode {
  return (WORK_MODES as readonly string[]).includes(value);
}

/**
 * Salary figures out of free text: "$120,000 - $150,000", "SEK 55 000/month", "€90k".
 *
 * Deliberately conservative. A posting that mentions "401k" or "1,000 employees" must not
 * produce a salary, so a number counts only when a currency marker sits next to it or a `k`
 * suffix follows it, and anything below a plausible floor is discarded.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '¥': 'JPY',
  kr: 'SEK',
};

const CURRENCY_CODES = /\b(USD|EUR|GBP|SEK|NOK|DKK|CHF|CAD|AUD|PLN|JPY|INR)\b/i;

/** Below this, a "salary" is far likelier to be a year, a headcount or a bullet number. */
const MIN_PLAUSIBLE_SALARY = 1000;

/**
 * "401(k)" is a retirement plan, not $401,000, and it appears in a large share of US
 * postings' benefits list — often near a dollar sign, where the `k` suffix rule would read
 * it as a salary. It is the one false positive common enough to name.
 */
const RETIREMENT_PLAN = /\b401\s*\(?k\)?/gi;

export interface SalaryGuess {
  min: number | null;
  max: number | null;
  currency: string | null;
}

export function parseSalaryText(text: string): SalaryGuess {
  const none: SalaryGuess = { min: null, max: null, currency: null };
  if (!text) return none;

  const codeMatch = CURRENCY_CODES.exec(text);
  let currency = codeMatch ? codeMatch[1]!.toUpperCase() : null;
  if (!currency) {
    for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
      if (text.includes(symbol)) {
        currency = code;
        break;
      }
    }
  }
  // No currency anywhere means every number on the page is a candidate — not worth guessing.
  if (!currency) return none;

  // A number, optionally grouped by spaces/commas/dots, optionally suffixed with k.
  const numbers: number[] = [];
  const pattern = /(\d[\d\s.,]*)(k\b)?/gi;
  for (const match of text.replace(RETIREMENT_PLAN, ' ').matchAll(pattern)) {
    const raw = match[1]!.replace(/[\s.,]/g, '');
    if (raw === '') continue;
    let value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (match[2]) value *= 1000;
    if (value < MIN_PLAUSIBLE_SALARY) continue;
    numbers.push(Math.round(value));
    if (numbers.length === 2) break;
  }

  if (numbers.length === 0) return none;
  const [first, second] = numbers;
  if (second === undefined) return { min: first!, max: null, currency };
  return { min: Math.min(first!, second), max: Math.max(first!, second), currency };
}

// ---------------------------------------------------------------- JSON-LD

/**
 * schema.org `JobPosting`, which most applicant tracking systems emit — Greenhouse, Lever,
 * Ashby, Workday, SmartRecruiters and most careers pages built on them. When it is present
 * it is by far the best source available: the site is telling us the fields directly rather
 * than us inferring them from markup that changes whenever someone redesigns a page.
 */
interface JsonLdNode {
  '@type'?: unknown;
  '@graph'?: unknown;
  [key: string]: unknown;
}

const LD_SCRIPT = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** The raw contents of every JSON-LD script tag in a document. */
function collectLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(LD_SCRIPT)) {
    if (match[1]) blocks.push(match[1]);
  }
  return blocks;
}

function pushNodes(value: unknown, into: JsonLdNode[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) pushNodes(entry, into);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const node = value as JsonLdNode;
  into.push(node);
  // `@graph` is how several generators wrap a page's nodes, JobPosting among them.
  if (node['@graph'] !== undefined) pushNodes(node['@graph'], into);
}

function hasType(node: JsonLdNode, type: string): boolean {
  const value = node['@type'];
  if (typeof value === 'string') return value.toLowerCase() === type.toLowerCase();
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === 'string' && entry.toLowerCase() === type.toLowerCase());
  }
  return false;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (Array.isArray(value)) {
      const found = firstString(...value);
      if (found !== '') return found;
    }
  }
  return '';
}

/** `jobLocation` is variously an object, an array of them, or a bare string. */
function locationFromNode(node: JsonLdNode): string {
  const raw = node.jobLocation;
  const entries = Array.isArray(raw) ? raw : [raw];
  const parts: string[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      parts.push(entry);
      continue;
    }
    if (entry === null || typeof entry !== 'object') continue;
    const address = (entry as JsonLdNode).address;
    if (typeof address === 'string') {
      parts.push(address);
      continue;
    }
    if (address === null || typeof address !== 'object') continue;
    const a = address as JsonLdNode;
    const city = firstString(a.addressLocality, a.addressRegion);
    const country = firstString(a.addressCountry, (a.addressCountry as JsonLdNode | undefined)?.name);
    parts.push([city, country].filter(Boolean).join(', '));
  }
  return parts.filter((part) => clean(part) !== '').join(' · ');
}

function salaryFromNode(node: JsonLdNode): SalaryGuess {
  const base = node.baseSalary;
  if (base === null || typeof base !== 'object') return { min: null, max: null, currency: null };
  const b = base as JsonLdNode;
  const currency = firstString(b.currency, b.salaryCurrency) || null;
  const value = b.value;
  if (value === null || typeof value !== 'object') {
    const flat = typeof value === 'number' ? value : null;
    return { min: flat, max: null, currency };
  }
  const v = value as JsonLdNode;
  const num = (raw: unknown): number | null => {
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(parsed) && parsed >= MIN_PLAUSIBLE_SALARY ? Math.round(parsed) : null;
  };
  const min = num(v.minValue) ?? num(v.value);
  const max = num(v.maxValue);
  return { min, max: max !== null && min !== null && max < min ? null : max, currency };
}

/**
 * Parse a fetched page into a draft, or null when it carries no `JobPosting` at all —
 * which is the signal for the caller to fall back to pasted text.
 */
export function parseJsonLdPosting(html: string, url?: string): PostingDraft | null {
  return parseJsonLdBlocks(collectLdBlocks(html), url);
}

/**
 * The same parse, from JSON-LD blocks already pulled out of a page.
 *
 * The browser extension takes this entry point: it reads the `<script type=ld+json>` tags
 * in the tab with `document.querySelectorAll` and sends back only their contents, which is
 * a few kilobytes where the whole page is often several megabytes.
 */
export function parseJsonLdBlocks(blocks: readonly string[], url?: string): PostingDraft | null {
  const nodes: JsonLdNode[] = [];
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim());
    } catch {
      continue;
    }
    pushNodes(parsed, nodes);
  }

  const node = nodes.find((entry) => hasType(entry, 'JobPosting'));
  if (!node) return null;

  const draft = emptyDraft();
  const org = node.hiringOrganization;
  draft.companyName = clean(
    typeof org === 'string' ? org : firstString((org as JsonLdNode | undefined)?.name),
  );
  draft.jobTitle = clean(firstString(node.title, node.name));

  const location = locationFromNode(node);
  draft.location = orNull(location, 200);

  // `jobLocationType: TELECOMMUTE` is schema.org's way of saying remote, and it is more
  // reliable than any keyword scan — but plenty of postings set only one of the two.
  const remoteFlag = firstString(node.jobLocationType).toUpperCase() === 'TELECOMMUTE';
  const declaredMode = clean(firstString(node.workMode)).toLowerCase();
  draft.workMode = remoteFlag
    ? 'remote'
    : isWorkMode(declaredMode)
      ? declaredMode
      : workModeFromText(`${location} ${clean(firstString(node.employmentType))}`);

  const salary = salaryFromNode(node);
  draft.salaryMin = salary.min;
  draft.salaryMax = salary.max;
  draft.salaryCurrency = salary.currency ? salary.currency.slice(0, 8) : null;

  const jobUrl = url ?? clean(firstString(node.url));
  draft.jobUrl = orNull(jobUrl, 2000);
  draft.sourceName = jobUrl ? sourceFromUrl(jobUrl) : null;

  return draft;
}

// ---------------------------------------------------------------- pasted text

/**
 * The fallback that always works: somebody selects a posting, copies it, and pastes it in.
 *
 * No network, no markup, no site that can block it — and correspondingly no structure to
 * rely on, so this is frankly a pile of heuristics over the shapes job pages actually
 * produce when copied. It is allowed to be wrong; the draft goes into a form, not the
 * database. What it must not do is silently invent a *company*, since that is what the
 * duplicate check keys on.
 */
const AT_COMPANY = /^(?<title>.+?)\s+(?:at|hos|@)\s+(?<company>[^|·—–-]{2,80})\s*$/i;
const COMPANY_SEPARATOR = /\s+[|·—–]\s+/;
/**
 * Wider than `COMPANY_SEPARATOR`, and used only when reading a *location* off a line.
 *
 * A plain hyphen belongs here — "Gothenburg - hybrid" is how half of these lines are
 * written — but deliberately not in the company separator, where "Backend Engineer -
 * Stockholm" would turn a city into an employer. Getting a location slightly wrong is a
 * typo; getting the company wrong creates a second employer and breaks duplicate detection.
 */
const LOCATION_SEPARATOR = /\s+[|·—–-]\s+/;
const SALARY_LINE = /\b(salary|compensation|pay|lön|lon|remuneration|base pay)\b/i;
const LOCATION_LINE = /^(?:location|based in|plats|ort|locations?)\s*[:·-]\s*(?<value>.+)$/i;

/**
 * Whether a line could be a place rather than a sentence.
 *
 * Short, few words, no sentence punctuation — enough to tell "Gothenburg - hybrid" from
 * "We are building the next generation of our deployment platform." Wrong occasionally, and
 * cheap when it is: the value lands in an editable field.
 */
function looksLikeLocation(line: string): boolean {
  if (line.length > 60 || SALARY_LINE.test(line)) return false;
  if (/[.!?](\s|$)/.test(line)) return false;
  return line.split(/\s+/).length <= 6;
}

export function parsePostingText(text: string, url?: string): PostingDraft {
  const draft = emptyDraft();
  if (url) {
    draft.jobUrl = orNull(url, 2000);
    draft.sourceName = sourceFromUrl(url);
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => clean(line))
    .filter((line) => line !== '');
  if (lines.length === 0) return draft;

  // The first line is nearly always the title, sometimes with the company attached.
  const first = lines[0]!;
  const atMatch = AT_COMPANY.exec(first);
  if (atMatch?.groups) {
    draft.jobTitle = clean(atMatch.groups.title!);
    draft.companyName = clean(atMatch.groups.company!);
    // With the company already named on line one, line two is usually the place.
    const second = lines[1];
    if (second && looksLikeLocation(second)) {
      draft.location = orNull(second.split(LOCATION_SEPARATOR)[0] ?? '', 200);
    }
  } else if (COMPANY_SEPARATOR.test(first)) {
    // "Backend Engineer | Spotify | Stockholm"
    const parts = first.split(COMPANY_SEPARATOR).map((part) => clean(part));
    draft.jobTitle = parts[0] ?? '';
    draft.companyName = parts[1] ?? '';
    if (parts[2]) draft.location = orNull(parts[2], 200);
  } else {
    draft.jobTitle = first;
    // A bare title on line one means line two is usually the company, sometimes with the
    // location behind a separator.
    const second = lines[1];
    if (second && second.length <= 80 && !SALARY_LINE.test(second)) {
      const parts = second.split(COMPANY_SEPARATOR).map((part) => clean(part));
      draft.companyName = parts[0] ?? '';
      if (parts[1]) draft.location = orNull(parts[1], 200);
    }
  }

  for (const line of lines) {
    const locationMatch = LOCATION_LINE.exec(line);
    if (locationMatch?.groups && draft.location === null) {
      draft.location = orNull(locationMatch.groups.value!, 200);
    }
    if (SALARY_LINE.test(line) && draft.salaryMin === null) {
      const salary = parseSalaryText(line);
      draft.salaryMin = salary.min;
      draft.salaryMax = salary.max;
      draft.salaryCurrency = salary.currency;
    }
  }

  draft.workMode = workModeFromText(`${draft.location ?? ''} ${text.slice(0, 4000)}`);

  // Everything pasted is kept as the opening's note: the parse above takes what it can
  // recognize, and this makes sure nothing the user copied is thrown away.
  draft.notes = orNull(text, 20000);

  return draft;
}
