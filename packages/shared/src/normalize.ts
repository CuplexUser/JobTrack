/**
 * Text normalization for duplicate detection.
 *
 * The whole point is that "Spotify AB", "spotify", and "  Spotify,  Inc. " are the same
 * employer, and that noticing this *before* the user saves a second application is the
 * feature. Every company and job title gets a derived key stored alongside the display
 * text; the key is what we compare, and the display text is what we show.
 */

/**
 * Company suffixes that carry no identity. Only ever stripped from the *end* of a name, so
 * a company genuinely called "Group Nine" keeps its first word.
 *
 * Ordered longest-first so "a/s" is tried before "as" and "corporation" before "corp".
 */
const LEGAL_SUFFIXES = [
  'incorporated',
  'corporation',
  'international',
  'holdings',
  'holding',
  'company',
  'limited',
  'group',
  'gmbh',
  'intl',
  'corp',
  'oyj',
  'plc',
  'pte',
  'pty',
  'llc',
  'ltd',
  'inc',
  'aps',
  'a/s',
  'bv',
  'nv',
  'sa',
  'ag',
  'ab',
  'as',
  'oy',
  'kg',
  'kk',
  'co',
  'srl',
  'spa',
] as const;

/**
 * Lowercase, strip diacritics, collapse whitespace.
 *
 * Diacritic stripping is what lets "Ericsson" match a copy-pasted "Èricsson", and matters
 * more than it looks in a Nordic job market.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reduce punctuation to spaces, but spell out `&` first so "AT&T" and "AT and T" converge
 * on the same key instead of differing by a token.
 */
function stripPunctuation(input: string): string {
  return input
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The comparison key for a company name.
 *
 * Legal suffixes are stripped repeatedly, because "Example Holdings Ltd" carries two. If
 * stripping would consume the entire name — a company actually named "AS" — the unstripped
 * form is kept rather than returning an empty key that would collide with every other
 * degenerate name.
 */
export function companyKey(name: string): string {
  const base = stripPunctuation(normalizeText(name));
  if (!base) return '';

  let current = base;
  // Repeat: a name can end in more than one suffix.
  for (;;) {
    const stripped = stripOneSuffix(current);
    if (stripped === null) break;
    if (!stripped) return current; // stripping would empty it out — keep what we have
    current = stripped;
  }
  return current;
}

function stripOneSuffix(value: string): string | null {
  for (const suffix of LEGAL_SUFFIXES) {
    // The suffix went through stripPunctuation too, so "a/s" is stored as "a s".
    const normalizedSuffix = stripPunctuation(suffix);
    if (value === normalizedSuffix) return '';
    if (value.endsWith(` ${normalizedSuffix}`)) {
      return value.slice(0, -(normalizedSuffix.length + 1)).trim();
    }
  }
  return null;
}

/**
 * The comparison key for a job title. Unlike a company, nothing is stripped: "Senior
 * Backend Engineer" and "Backend Engineer" are genuinely different roles and should not
 * collapse into one another. Only case, accents and punctuation are normalized away.
 */
export function titleKey(title: string): string {
  return stripPunctuation(normalizeText(title));
}

/**
 * The comparison key for a tag name, so "Remote OK", "remote-ok" and "remote ok" are one tag.
 */
export function tagKey(name: string): string {
  return stripPunctuation(normalizeText(name));
}

/**
 * Tidy a company name for *display* without changing its identity: collapse whitespace and
 * trim. Deliberately preserves the user's capitalization and legal suffix — the key handles
 * matching, and overriding what someone typed would be presumptuous.
 */
export function displayName(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}
