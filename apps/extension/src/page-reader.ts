/**
 * The half that runs inside the inspected tab.
 *
 * `chrome.scripting.executeScript({ func })` serializes the function and evaluates it in
 * the page, which means it carries **no imports** — anything it needs has to arrive through
 * `args`, and anything it produces has to be structured-cloneable. So this file does no
 * parsing at all: it reads the DOM, returns strings, and everything clever happens back in
 * the popup where the shared parsers are available.
 *
 * That split is also what keeps the extension's read cheap. A LinkedIn job page is several
 * megabytes of HTML; the JSON-LD blocks and half a dozen selector hits are a few kilobytes.
 */

/** Exactly the selector lists `sites.ts` holds, flattened to what the page needs. */
export interface PageSelectors {
  title?: string[];
  company?: string[];
  location?: string[];
  salary?: string[];
  description?: string[];
}

export interface PageSnapshot {
  url: string;
  hostname: string;
  title: string;
  selection: string;
  /** The contents of every `<script type="application/ld+json">` on the page. */
  ldBlocks: string[];
  /** Selector hits, empty strings where nothing matched. */
  fields: {
    title: string;
    company: string;
    location: string;
    salary: string;
    description: string;
  };
}

/**
 * Injected into the tab. Written as a standalone function with no free variables beyond its
 * argument and the page's own globals — that is a hard requirement, not a style choice.
 */
export function readPage(selectors: PageSelectors): PageSnapshot {
  const first = (list: string[] | undefined): string => {
    for (const selector of list ?? []) {
      let element: Element | null = null;
      try {
        element = document.querySelector(selector);
      } catch {
        continue; // A selector that no longer parses must not take the whole read down.
      }
      const text = element?.textContent?.replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return '';
  };

  const ldBlocks: string[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    const content = script.textContent;
    if (content && content.trim() !== '') ldBlocks.push(content);
  }

  const description = first(selectors.description);

  return {
    url: location.href,
    hostname: location.hostname,
    title: document.title,
    selection: window.getSelection()?.toString().trim() ?? '',
    ldBlocks,
    fields: {
      title: first(selectors.title),
      company: first(selectors.company),
      location: first(selectors.location),
      salary: first(selectors.salary),
      // The prose is what makes an opening worth reopening in three weeks, so it is worth
      // the bytes — capped, because some postings are enormous.
      description: (description || document.body?.innerText || '').replace(/\s+\n/g, '\n').trim().slice(0, 20000),
    },
  };
}
