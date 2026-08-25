import { describe, expect, it } from 'vitest';
import { companyKey, displayName, normalizeText, tagKey, titleKey } from './normalize.js';

describe('normalizeText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeText('  Spotify   AB  ')).toBe('spotify ab');
  });

  it('strips diacritics so a copy-pasted name still matches', () => {
    expect(normalizeText('Ericsson Malmö')).toBe('ericsson malmo');
    expect(normalizeText('Zürich Insurance')).toBe('zurich insurance');
  });
});

describe('companyKey', () => {
  it('treats a legal suffix as noise', () => {
    expect(companyKey('Spotify AB')).toBe('spotify');
    expect(companyKey('spotify')).toBe('spotify');
    expect(companyKey('Spotify, Inc.')).toBe('spotify');
    expect(companyKey('  SPOTIFY   ab ')).toBe('spotify');
  });

  it('strips more than one trailing suffix', () => {
    expect(companyKey('Example Holdings Ltd')).toBe('example');
  });

  it('only strips suffixes from the end', () => {
    // "Group" leads here, so it is part of the name rather than a suffix.
    expect(companyKey('Group Nine Media')).toBe('group nine media');
  });

  it('keeps the name when stripping would empty it', () => {
    // A company genuinely called "AS" must not collapse to an empty key that would
    // collide with every other degenerate name.
    expect(companyKey('AS')).toBe('as');
  });

  it('converges on & and the word "and"', () => {
    expect(companyKey('AT&T')).toBe(companyKey('AT and T'));
  });

  it('is empty for input with no usable characters', () => {
    expect(companyKey('   ')).toBe('');
    expect(companyKey('!!!')).toBe('');
  });
});

describe('titleKey', () => {
  it('normalizes case and punctuation', () => {
    expect(titleKey('Senior Backend Engineer')).toBe('senior backend engineer');
    expect(titleKey('Back-End  Engineer!')).toBe('back end engineer');
  });

  it('does NOT strip seniority, because those are different roles', () => {
    expect(titleKey('Senior Backend Engineer')).not.toBe(titleKey('Backend Engineer'));
  });
});

describe('tagKey', () => {
  it('folds the ways a tag gets typed into one', () => {
    expect(tagKey('Remote OK')).toBe('remote ok');
    expect(tagKey('remote-ok')).toBe('remote ok');
    expect(tagKey('  REMOTE_OK ')).toBe('remote ok');
  });
});

describe('displayName', () => {
  it('tidies whitespace but preserves what the user typed', () => {
    expect(displayName('  Spotify   AB ')).toBe('Spotify AB');
  });
});
