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

/** The entities that survive a copy out of HTML often enough to be worth naming. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  hellip: '…',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  middot: '·',
};

const ENTITY = /&(#x?[0-9a-f]+|[a-z]+);/gi;

/** Entities back to the characters they stand for, numeric ones included. */
function decodeEntities(value: string): string {
  return value.replace(ENTITY, (whole, body: string) => {
    const name = body.toLowerCase();
    if (name.startsWith('#')) {
      const code = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name] ?? whole;
  });
}

/** Collapse the whitespace and entity noise that survives extraction from HTML or a page. */
function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

/**
 * The same tidy-up as `clean`, with the line breaks left standing.
 *
 * Notes are read by a person, not matched by a filter, so a posting's paragraphs and bullet
 * list are the whole value of keeping it. What goes is only what nobody wants: trailing
 * space, and the runs of blank lines a page dump is full of.
 */
function tidyLines(value: string): string {
  return decodeEntities(value)
    .replace(/\r\n?/g, '\n')
    // Every kind of horizontal space collapses; the vertical ones are the structure.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Trimmed text, or null — matching how the schemas treat an empty box as "not set". */
function orNull(value: string, max: number): string | null {
  const text = clean(value);
  if (text === '') return null;
  return text.length > max ? text.slice(0, max) : text;
}

// ---------------------------------------------------------------- page text

/** A note longer than this is not a posting any more, it is a website. */
export const MAX_NOTE_LENGTH = 20_000;

/**
 * What a posting is worth keeping as a note, or null when there is nothing left.
 *
 * One place decides it for all three capture routes, so an opening clipped from a page
 * carries the same kind of text as one pasted in by hand: the posting's own words, with
 * their line breaks, and without the page they were printed on.
 */
export function postingNote(text: string): string | null {
  const note = tidyLines(stripPageChrome(text));
  if (note === '') return null;
  return note.length > MAX_NOTE_LENGTH ? note.slice(0, MAX_NOTE_LENGTH) : note;
}

/**
 * Elements that are the site rather than the posting. Dropped whole, contents included,
 * because a navigation bar's text is exactly the "Log in / Language / Search" noise that
 * makes a captured note unreadable.
 */
const CHROME_ELEMENTS =
  /<(nav|header|footer|aside|script|style|noscript|form|select|button|svg|template|dialog)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * Tags that end a line of text, so a paragraph does not run into the next heading.
 *
 * `</li>` is deliberately absent: `<li>` already opens a line with its bullet, and ending
 * one here as well would put a blank line between every item of a requirements list.
 */
const BLOCK_END = /<\/(p|div|section|article|ul|ol|tr|table|h[1-6]|blockquote|pre|dd|dt)\s*>/gi;
const LINE_BREAK = /<(?:br|hr)\s*\/?>/gi;
const LIST_ITEM = /<li\b[^>]*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const ANY_TAG = /<[^>]+>/g;

/**
 * HTML to the text a reader would see, keeping the lines.
 *
 * Deliberately regex work rather than a parser: this file compiles against neither the DOM
 * nor Node, and a posting's description is prose in simple markup — paragraphs, lists,
 * headings — not a document that needs a tree to understand.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(COMMENT, ' ')
    // A line break in the source is not a line break on the page; the tags are what decide
    // where one falls, and a pretty-printed document would otherwise come out double-spaced.
    .replace(/\s+/g, ' ')
    .replace(CHROME_ELEMENTS, '\n')
    .replace(LINE_BREAK, '\n')
    .replace(LIST_ITEM, '\n• ')
    .replace(BLOCK_END, '\n')
    .replace(ANY_TAG, ' ');
  // A list is one thing, so it is not opened by a blank line the paragraph tag put there.
  return tidyLines(text).replace(/\n{2,}(?=• )/g, '\n');
}

/** The part of a page that holds its content, when the markup says which part that is. */
const MAIN_ELEMENT = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/i;
const BODY_ELEMENT = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i;

/**
 * The readable text of a fetched page: its main content where the markup names one, the
 * body otherwise, in both cases without the site's own furniture.
 *
 * This is the fallback for a posting whose structured data is thin — better a description
 * taken from the page than an opening with nothing in it, and better the article than the
 * whole document, since everything outside it is the website.
 */
export function readableTextFromHtml(html: string): string {
  const withoutChrome = html.replace(CHROME_ELEMENTS, '\n');
  const main = MAIN_ELEMENT.exec(withoutChrome)?.[2];
  const body = BODY_ELEMENT.exec(withoutChrome)?.[1];
  return htmlToText(main ?? body ?? withoutChrome);
}

/**
 * Lines that belong to the website rather than to the job ad.
 *
 * Matched whole, never as a substring: "Search" on a line of its own is a navigation link,
 * while "Search" inside "you will own our search stack" is the job. Anything that needs
 * more judgment than that is left in — a note with one stray line is a small annoyance,
 * a note missing a requirement is a wrong record.
 */
const CHROME_LINES = new Set([
  'about',
  'about us',
  'accept',
  'accept all',
  'accept all cookies',
  'accept cookies',
  'all jobs',
  'all rights reserved',
  'apply',
  'apply for this job',
  'apply now',
  'back',
  'back to jobs',
  'back to search results',
  'careers',
  'contact',
  'contact us',
  'cookie policy',
  'cookie settings',
  'cookies',
  'create account',
  'english',
  'follow us',
  'home',
  'jobs',
  'language',
  'languages',
  'learn more',
  'loading',
  'log in',
  'log out',
  'login',
  'manage cookies',
  'menu',
  'my account',
  'necessary cookies only',
  'newsletter',
  'next',
  'previous',
  'print',
  'privacy',
  'privacy policy',
  'profile',
  'read more',
  'register',
  'reject all',
  'save job',
  'search',
  'search jobs',
  'see all jobs',
  'settings',
  'share',
  'share this job',
  'show less',
  'show more',
  'sign in',
  'sign up',
  'skip to content',
  'skip to main content',
  'subscribe',
  'svenska',
  'terms',
  'terms and conditions',
  'terms of service',
  'terms of use',
  'view all jobs',
]);

/** A copyright line is the foot of the page wherever it appears. */
const COPYRIGHT = /^(©|\(c\)|copyright\b)/i;

/** Leading bullets and trailing punctuation, so "• Search:" is judged as "search". */
const LINE_FURNITURE = /^[\s*•·\-–—|>]+|[\s:.,;!|]+$/g;

/**
 * Drop the lines a page carries around its posting.
 *
 * Applies to every route: the extension leaves out the page's navigation before it ever
 * reads the text, but a description container can still end with a "Share this job" row,
 * and a pasted copy of a page carries whatever the user's selection swept up.
 */
export function stripPageChrome(text: string): string {
  const kept: string[] = [];
  for (const line of tidyLines(text).split('\n')) {
    const bare = line.replace(LINE_FURNITURE, '').toLowerCase();
    if (bare !== '' && (CHROME_LINES.has(bare) || COPYRIGHT.test(bare))) continue;
    // Two identical lines in a row are a page repeating itself, which nothing gains from.
    if (line !== '' && kept[kept.length - 1] === line) continue;
    kept.push(line);
  }
  return tidyLines(kept.join('\n'));
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

/** One `jobLocation` entry as a readable place, or '' when it names none. */
function placeFromEntry(entry: unknown): string {
  if (typeof entry === 'string') return clean(entry);
  if (entry === null || typeof entry !== 'object') return '';

  const place = entry as JsonLdNode;
  const address = place.address;
  if (typeof address === 'string') return clean(address);

  if (address !== null && typeof address === 'object') {
    const a = address as JsonLdNode;
    const city = firstString(a.addressLocality, a.addressRegion);
    const country = firstString(a.addressCountry, (a.addressCountry as JsonLdNode | undefined)?.name);
    const written = clean([city, country].filter(Boolean).join(', '));
    if (written !== '') return written;
  }
  // A Place with no address at all still often carries "Stockholm Office" as its name.
  return clean(firstString(place.name));
}

/**
 * Where the job is, out of a `JobPosting` node.
 *
 * `jobLocation` is variously an object, an array of them, or a bare string, and a fair
 * number of postings leave it out entirely — a remote role says so with `jobLocationType`
 * and names the countries it will hire from in `applicantLocationRequirements` instead.
 * Reading only the first of those is what left the location box empty on postings that
 * plainly stated where the work happens.
 */
function locationFromNode(node: JsonLdNode): string {
  const raw = node.jobLocation;
  const entries = Array.isArray(raw) ? raw : [raw];
  const parts: string[] = [];
  for (const entry of entries) {
    const place = placeFromEntry(entry);
    // The same city twice is how a posting lists two offices in one place.
    if (place !== '' && !parts.includes(place)) parts.push(place);
  }
  if (parts.length > 0) return parts.join(' · ');

  const remote = firstString(node.jobLocationType).toUpperCase() === 'TELECOMMUTE';
  const requirements = node.applicantLocationRequirements;
  const where = (Array.isArray(requirements) ? requirements : [requirements])
    .map((entry) => (typeof entry === 'string' ? clean(entry) : clean(firstString((entry as JsonLdNode | null)?.name))))
    .filter((name) => name !== '');

  if (where.length > 0) return remote ? `Remote (${where.join(', ')})` : where.join(' · ');
  return remote ? 'Remote' : '';
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

  // The posting's own `description`, which is the job ad and nothing else — no navigation,
  // no cookie banner, no "Log in" from the page it was printed on. It is HTML in nearly
  // every applicant tracking system, so it is read the way a reader would see it.
  draft.notes = postingNote(htmlToText(firstString(node.description)));

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

/**
 * A line that labels a place: "Location: Stockholm", "Ort Kista", "Office · Malmö".
 *
 * The label may be followed by a separator or by nothing but space, because plenty of pages
 * print the label and the value as two cells of a table that copy out as one line. That
 * width is only safe because `looksLikeLocation` has the last word — without it, "Location
 * matters to us, which is why every team chooses its own" would become a city.
 */
const LOCATION_LINE =
  /^(?:(?:locations?|job locations?|work locations?|based in|plats|ort|arbetsort|placering)\s*(?:[:·|–—-]\s*|\s+)|(?:office|city|region|site)\s*[:·|–—-]\s*)(?<value>.+)$/i;

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

/**
 * The place a block of text labels, if it labels one.
 *
 * The one location heuristic every route shares. A posting's page says where the job is in
 * a line of its own far more often than its structured data does, so this is what the
 * clipper and the link importer fall back to before leaving the box empty — which, on a
 * site whose markup names no city, is what used to happen every time.
 */
export function locationFromText(text: string): string | null {
  for (const line of tidyLines(text).split('\n')) {
    const match = LOCATION_LINE.exec(line);
    const value = match?.groups ? clean(match.groups.value!) : '';
    if (value !== '' && looksLikeLocation(value)) {
      return orNull(value.split(LOCATION_SEPARATOR)[0] ?? value, 200);
    }
  }
  return null;
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
    if (SALARY_LINE.test(line) && draft.salaryMin === null) {
      const salary = parseSalaryText(line);
      draft.salaryMin = salary.min;
      draft.salaryMax = salary.max;
      draft.salaryCurrency = salary.currency;
    }
  }

  draft.location ??= locationFromText(lines.join('\n'));
  draft.workMode = workModeFromText(`${draft.location ?? ''} ${text.slice(0, 4000)}`);

  // Everything pasted is kept as the opening's note: the parse above takes what it can
  // recognize, and this makes sure nothing the user copied is thrown away — minus the rows
  // of site navigation that come along when the copy was made from a page rather than from
  // the posting itself.
  draft.notes = postingNote(text);

  return draft;
}
