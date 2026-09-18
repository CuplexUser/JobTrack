/**
 * Turning what the tab reported into a draft.
 *
 * This is the reason the extension exists. LinkedIn and Indeed will not answer a server
 * that asks them for a page, and no amount of cleverness on the API side changes that — but
 * the browser already has the posting rendered, in the user's own session, because they are
 * reading it. Clipping from there takes what is already on screen, once, when a button is
 * pressed.
 *
 * Order of preference, best first:
 *
 * 1. **schema.org JSON-LD** — the site stating the fields itself. Survives redesigns.
 * 2. **Per-site selectors** (`sites.ts`) — for the boards that publish no structured data.
 * 3. **The page title or the user's selection** — never nothing.
 *
 * What the winner does *not* say, the others still can: structured data that names no city
 * is ordinary, and one route deciding every field is why a posting with the location in
 * plain sight on the page arrived here with an empty location box. So the best available
 * source wins each field, rather than the first usable source winning all of them.
 *
 * Every parse is `@jobtrack/shared`, the same code the API and the web app run, so a posting
 * captured here produces the same record as one captured any other way.
 */

import {
  emptyDraft,
  isUsableDraft,
  locationFromText,
  parseJsonLdBlocks,
  parsePostingText,
  parseSalaryText,
  postingNote,
  sourceFromUrl,
  workModeFromText,
  type PostingDraft,
} from '@jobtrack/shared/posting';
import type { PageSnapshot } from './page-reader.js';
import { rulesFor } from './sites.js';

export interface Extraction {
  draft: PostingDraft;
  /** Which route produced it — shown in the popup, so a bad parse is explainable. */
  method: string;
}

/** A selector hit, or null when nothing matched — the shape the draft fields are in. */
function found(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * Fill the fields the chosen source left empty from the rest of the page.
 *
 * Only ever fills — a value the structured data stated is never overwritten by a guess off
 * the markup. The description is where both of the remaining fields come from when the page
 * states them nowhere else, and it is read after the site's navigation, cookie banner and
 * footer have already been left out of it.
 */
function fillGaps(draft: PostingDraft, snapshot: PageSnapshot): void {
  const { fields } = snapshot;

  draft.location ??= found(fields.location) ?? locationFromText(fields.description);
  draft.notes ??= postingNote(fields.description);

  if (draft.salaryMin === null && fields.salary !== '') {
    const salary = parseSalaryText(fields.salary);
    draft.salaryMin = salary.min;
    draft.salaryMax = salary.max;
    draft.salaryCurrency = salary.currency;
  }

  if (draft.workMode === 'unspecified') {
    draft.workMode = workModeFromText(`${draft.location ?? ''} ${fields.description.slice(0, 4000)}`);
  }
}

/**
 * LinkedIn's `document.title` is "`<Company> hiring <Title> in <Location>`", not the generic
 * "Title - Company - Location" shape `parsePostingText` knows: the generic separator splitter
 * has no notion of "hiring"/"in" and mangles this into garbage. Parsed directly instead, since
 * this shape is a much slower-moving thing for LinkedIn to change than any CSS class.
 */
const LINKEDIN_TITLE =
  /^(?<company>.+?)\s+hiring\s+(?<title>.+?)(?:\s+in\s+(?<location>.+?))?\s*(?:\|\s*LinkedIn)?$/i;

/**
 * Indeed's `document.title` ends in "- Indeed.com" and, critically, often has no company at
 * all — "`<Title> - <Location> - Indeed.com`" — which the generic fallback misreads as
 * "`<Title>`" at company "`<Location>`", since it assumes a bare second segment names the
 * employer. The last segment before the "Indeed.com" suffix is the location; anything between
 * the title and that is the company, when present.
 */
const INDEED_SUFFIX = /\s*[-|]\s*indeed(?:\.com)?\s*$/i;
const INDEED_SEGMENT = /\s+-\s+/;

function titleShapeDraft(hostname: string, title: string, url: string): PostingDraft | null {
  if (hostname.endsWith('linkedin.com')) {
    const match = LINKEDIN_TITLE.exec(title);
    const company = found(match?.groups?.company ?? '');
    const role = found(match?.groups?.title ?? '');
    if (!company || !role) return null;
    const draft = emptyDraft();
    draft.companyName = company;
    draft.jobTitle = role;
    draft.location = found(match?.groups?.location ?? '');
    draft.jobUrl = url;
    draft.sourceName = sourceFromUrl(url);
    return draft;
  }

  if (hostname.endsWith('indeed.com')) {
    const withoutSuffix = title.replace(INDEED_SUFFIX, '').trim();
    const segments = withoutSuffix.split(INDEED_SEGMENT).map((part) => part.trim());
    const role = found(segments[0] ?? '');
    if (!role) return null;
    const draft = emptyDraft();
    draft.jobTitle = role;
    if (segments.length >= 3) {
      draft.companyName = found(segments.slice(1, -1).join(' - ')) ?? '';
      draft.location = found(segments[segments.length - 1] ?? '');
    } else if (segments.length === 2) {
      draft.location = found(segments[1] ?? '');
    }
    draft.jobUrl = url;
    draft.sourceName = sourceFromUrl(url);
    return draft;
  }

  return null;
}

/**
 * "Lund, Skåne län" -> "Lund" — the **JobTrack Clipper → Settings** "city only" preference.
 *
 * Only ever trims a plain two-part "City, Region" pair. A parenthesized location like
 * "Remote (Sweden, Norway)" or a multi-office one joined with " · " is left exactly as read:
 * guessing which of three or more parts is "the city" is a worse mistake than leaving the
 * fuller string in place, and a comma inside parentheses is not the same separator at all.
 */
export function simplifyLocation(location: string): string {
  if (location.includes('(')) return location;
  const parts = location.split(',').map((part) => part.trim()).filter((part) => part !== '');
  return parts.length === 2 ? parts[0]! : location;
}

export function buildDraft(snapshot: PageSnapshot): Extraction {
  const { url, fields } = snapshot;

  const structured = parseJsonLdBlocks(snapshot.ldBlocks, url);
  if (structured && isUsableDraft(structured)) {
    // JSON-LD often carries no prose, and the prose is what makes an opening worth
    // reopening later, so that comes from the page even when the rest came from the markup.
    fillGaps(structured, snapshot);
    return { draft: structured, method: 'the posting’s own structured data' };
  }

  const rules = rulesFor(snapshot.hostname);
  if (rules && fields.company && fields.title) {
    const draft = emptyDraft();
    draft.jobTitle = fields.title;
    draft.companyName = fields.company;
    draft.jobUrl = url;
    draft.sourceName = sourceFromUrl(url);
    fillGaps(draft, snapshot);

    return { draft, method: `the ${rules.label} page layout` };
  }

  // LinkedIn and Indeed both title their tabs in a fixed shape that says more than the
  // generic "Title - Company - Location" splitter below can safely assume — in particular,
  // Indeed's title is routinely "Title - Location - Indeed.com" with no company at all, which
  // the generic splitter misreads as company. Accepted on a title alone, deliberately not
  // gated on `isUsableDraft`: a title and a correct location beats the generic splitter's
  // habit of mistaking that same location for the company name. Tried only when there is no
  // text selection to prefer, same as the generic fallback below.
  if (snapshot.selection === '') {
    const shaped = titleShapeDraft(snapshot.hostname, snapshot.title, url);
    if (shaped && shaped.jobTitle !== '') {
      fillGaps(shaped, snapshot);
      return { draft: shaped, method: `the ${snapshot.hostname.replace(/^www\./, '')} tab title` };
    }
  }

  // Last resort. A job page's title is very often "Title - Company - Location", which the
  // text parser already knows how to split, so it gets the separators turned into lines.
  const usedSelection = snapshot.selection !== '';
  const source = usedSelection ? snapshot.selection : snapshot.title.replace(/\s+[-|·—]\s+/g, '\n');
  const draft = parsePostingText(source, url);
  // A title-derived note would just be the title again; the page text is more useful.
  if (!usedSelection) draft.notes = null;
  fillGaps(draft, snapshot);

  return { draft, method: usedSelection ? 'the text you selected' : 'the page title' };
}
