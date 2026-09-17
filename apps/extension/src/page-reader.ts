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
 * argument and the page's own globals — that is a hard requirement, not a style choice, so
 * every constant below lives inside it rather than at the top of this file.
 */
export function readPage(selectors: PageSelectors): PageSnapshot {
  /**
   * Containers that hold a job description on sites with no per-site rules and no
   * structured data. Tried in order, first hit wins, and the last two are the ordinary way
   * a page says "this is the content" — which beats the body by the whole menu around it.
   */
  const DESCRIPTION_CANDIDATES = [
    '[itemprop="description"]',
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[id*="job-description"]',
    '[id*="jobDescription"]',
    '[data-testid*="description"]',
    '[class*="posting-description"]',
    '[class*="job-details"]',
    '[class*="job-post"]',
    'article',
    'main',
    '[role="main"]',
  ];

  /** Where a page states a location when it publishes no structured data at all. */
  const LOCATION_CANDIDATES = [
    '[itemprop="jobLocation"]',
    '[itemprop="addressLocality"]',
    '[data-testid*="location"]',
    '[class*="job-location"]',
    '[class*="jobLocation"]',
    '[class*="posting-location"]',
    '[class*="location"]',
  ];

  /** Elements that are the site rather than the posting, skipped wherever they turn up. */
  const CHROME_TAGS = [
    'NAV',
    'HEADER',
    'FOOTER',
    'ASIDE',
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'FORM',
    'SELECT',
    'BUTTON',
    'TEXTAREA',
    'IFRAME',
    'SVG',
    'DIALOG',
  ];

  /**
   * Class and id words that name page furniture. Matched as whole words within a class
   * list, never as substrings — `nav` must not take out `innovation-team`.
   */
  const CHROME_WORDS = [
    'nav',
    'navbar',
    'navigation',
    'menu',
    'header',
    'footer',
    'sidebar',
    'breadcrumb',
    'breadcrumbs',
    'cookie',
    'cookies',
    'consent',
    'banner',
    'masthead',
    'topbar',
    'toolbar',
    'skip',
    'social',
    'share',
    'newsletter',
    'subscribe',
    'login',
    'signup',
    'modal',
    'overlay',
    'popup',
  ];

  /** Tags after which the text starts a new line, so a list does not read as one sentence. */
  const BLOCK_TAGS = [
    'P',
    'DIV',
    'SECTION',
    'ARTICLE',
    'LI',
    'UL',
    'OL',
    'TR',
    'TABLE',
    'BR',
    'HR',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'BLOCKQUOTE',
    'PRE',
    'DD',
    'DT',
  ];

  // SVG and MathML elements report a lowercase `tagName`, and their `className` is an object
  // rather than a string, so both are normalized before anything is compared.
  const tagOf = (element: Element): string => element.tagName.toUpperCase();

  const isChrome = (element: Element): boolean => {
    if (CHROME_TAGS.indexOf(tagOf(element)) !== -1) return true;
    if (element.getAttribute('aria-hidden') === 'true') return true;
    const role = element.getAttribute('role');
    if (role === 'navigation' || role === 'banner' || role === 'contentinfo' || role === 'search') {
      return true;
    }
    const words = `${String(element.className)} ${element.id}`.toLowerCase().split(/[^a-z]+/);
    for (const word of words) {
      if (word !== '' && CHROME_WORDS.indexOf(word) !== -1) return true;
    }
    return false;
  };

  /**
   * The text of an element as a reader sees it, with the site's furniture left out.
   *
   * `innerText` would be the obvious answer and is the wrong one: it takes the whole
   * subtree, navigation included, which is how a captured note ended up full of "Log in",
   * "Language" and "Search". Walking the tree is what makes leaving those out possible.
   */
  const textOf = (root: Element | null): string => {
    if (!root) return '';
    const out: string[] = [];
    const visit = (node: Node): void => {
      if (node.nodeType === 3) {
        out.push(node.nodeValue ?? '');
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node as Element;
      if (isChrome(element)) return;
      const tag = tagOf(element);
      const block = BLOCK_TAGS.indexOf(tag) !== -1;
      if (block) out.push('\n');
      if (tag === 'LI') out.push('• ');
      for (const child of Array.from(element.childNodes)) visit(child);
      if (block) out.push('\n');
    };
    visit(root);
    return out
      .join('')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const firstElement = (list: string[] | undefined): Element | null => {
    for (const selector of list ?? []) {
      let element: Element | null = null;
      try {
        element = document.querySelector(selector);
      } catch {
        continue; // A selector that no longer parses must not take the whole read down.
      }
      if (element && !isChrome(element) && (element.textContent ?? '').trim() !== '') return element;
    }
    return null;
  };

  const first = (list: string[] | undefined): string => {
    const element = firstElement(list);
    const text = element?.textContent?.replace(/\s+/g, ' ').trim();
    return text ?? '';
  };

  const ldBlocks: string[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    const content = script.textContent;
    if (content && content.trim() !== '') ldBlocks.push(content);
  }

  // The site's own rules first, then the shapes every other page is built from, then the
  // body — which is the last resort rather than, as before, the usual outcome.
  const description =
    firstElement(selectors.description) ?? firstElement(DESCRIPTION_CANDIDATES) ?? document.body;

  // A generic `[class*="location"]` hit is worth having and worth doubting: a long one is
  // an office address list in a footer, not where this job is.
  const where = first(selectors.location) || first(LOCATION_CANDIDATES);

  return {
    url: window.location.href,
    hostname: window.location.hostname,
    title: document.title,
    selection: window.getSelection()?.toString().trim() ?? '',
    ldBlocks,
    fields: {
      title: first(selectors.title),
      company: first(selectors.company),
      location: where.length <= 120 ? where : '',
      salary: first(selectors.salary),
      // The prose is what makes an opening worth reopening in three weeks, so it is worth
      // the bytes — capped, because some postings are enormous.
      description: textOf(description).slice(0, 20000),
    },
  };
}
