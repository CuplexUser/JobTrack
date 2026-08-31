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
 * Every parse is `@jobtrack/shared`, the same code the API and the web app run, so a posting
 * captured here produces the same record as one captured any other way.
 */

import {
  emptyDraft,
  isUsableDraft,
  parseJsonLdBlocks,
  parsePostingText,
  parseSalaryText,
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

export function buildDraft(snapshot: PageSnapshot): Extraction {
  const { url, fields } = snapshot;

  const structured = parseJsonLdBlocks(snapshot.ldBlocks, url);
  if (structured && isUsableDraft(structured)) {
    // JSON-LD rarely carries the prose, and the prose is what makes an opening worth
    // reopening later, so take that from the page even when the rest came from the markup.
    structured.notes = structured.notes ?? (fields.description || null);
    return { draft: structured, method: 'the posting’s own structured data' };
  }

  const rules = rulesFor(snapshot.hostname);
  if (rules && fields.company && fields.title) {
    const draft = emptyDraft();
    draft.jobTitle = fields.title;
    draft.companyName = fields.company;
    draft.location = fields.location || null;
    draft.jobUrl = url;
    draft.sourceName = sourceFromUrl(url);
    draft.notes = fields.description || null;

    if (fields.salary) {
      const salary = parseSalaryText(fields.salary);
      draft.salaryMin = salary.min;
      draft.salaryMax = salary.max;
      draft.salaryCurrency = salary.currency;
    }
    draft.workMode = workModeFromText(`${draft.location ?? ''} ${fields.description.slice(0, 4000)}`);

    return { draft, method: `the ${rules.label} page layout` };
  }

  // Last resort. A job page's title is very often "Title - Company - Location", which the
  // text parser already knows how to split, so it gets the separators turned into lines.
  const usedSelection = snapshot.selection !== '';
  const source = usedSelection ? snapshot.selection : snapshot.title.replace(/\s+[-|·—]\s+/g, '\n');
  const draft = parsePostingText(source, url);
  // A title-derived note would just be the title again; the page text is more useful.
  if (!usedSelection) draft.notes = fields.description || null;

  return { draft, method: usedSelection ? 'the text you selected' : 'the page title' };
}
