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
